import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface DynamicToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DynamicToolCallRequest {
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface DynamicToolResponse {
  contentItems: Array<
    | {
        type: "inputText";
        text: string;
      }
    | {
        type: "inputImage";
        imageUrl: string;
      }
  >;
  success: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface PubMedSearchResponse {
  esearchresult?: {
    idlist?: string[];
  };
}

interface PubMedSummaryAuthor {
  name?: string;
}

interface PubMedSummaryArticleId {
  idtype?: string;
  value?: string;
}

interface PubMedSummaryRecord {
  uid?: string;
  title?: string;
  pubdate?: string;
  fulljournalname?: string;
  authors?: PubMedSummaryAuthor[];
  articleids?: PubMedSummaryArticleId[];
}

interface PubMedSummaryResponse {
  result?: {
    uids?: string[];
    [uid: string]: PubMedSummaryRecord | string[] | undefined;
  };
}

interface UnpaywallLocation {
  url?: string;
  url_for_pdf?: string;
}

interface UnpaywallResponse {
  doi?: string;
  doi_url?: string;
  title?: string;
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[] | null;
}

const OLLAMA_WEB_SEARCH_TOOL_PROFILE = "ollama-web-search-v1";
const DEFAULT_RESULT_LIMIT = 5;
const MAX_RESULT_LIMIT = 8;
const SEARCH_BACKEND_BASE_URL = "https://r.jina.ai/http://www.ecosia.org/search";
const PUBMED_SEARCH_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_SUMMARY_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const UNPAYWALL_BASE_URL = "https://api.unpaywall.org/v2";
const PUBMED_DOMAINS = new Set(["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"]);
const BIOLOGICAL_QUERY_PATTERN =
  /\b(pubmed|gene|genes|genetic|genomics?|dna|rna|protein|proteins|enzyme|cell|cells|pathway|mutation|variant|biomarker|antibody|microbiome|metabol(?:ism|ite|omic)|transcript(?:ome|omic)?|proteom(?:e|ic)|cancer|tumou?r|disease|syndrome|immune|immunology|infection|virus|viral|bacteria|bacterial|fungal|neuron|neural|brain|clinical trial|therapeutic|drug target|receptor|ligand|crispr|biology|biological|biomedical)\b/i;

const OLLAMA_WEB_SEARCH_TOOL: DynamicToolSpec = {
  name: "web_search",
  description:
    "Search the public web for current information. Use this when you need recent facts, external references, or URLs. Biological and biomedical queries may be routed to PubMed. Returns concise search results with titles, links, and snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to run on the public web.",
      },
      domains: {
        type: "array",
        description: "Optional domains to restrict results to, for example ['ollama.com', 'github.com'].",
        items: {
          type: "string",
        },
      },
      limit: {
        type: "integer",
        description: "Optional number of results to return. Defaults to 5 and is capped at 8.",
        minimum: 1,
        maximum: MAX_RESULT_LIMIT,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const DOWNLOAD_OPEN_ACCESS_PDF_TOOL: DynamicToolSpec = {
  name: "download_open_access_pdf",
  description:
    "Given a DOI, use Unpaywall to find an open-access PDF, download it to /tmp, and return the saved local path. Use this when the user wants the paper PDF itself.",
  inputSchema: {
    type: "object",
    properties: {
      doi: {
        type: "string",
        description: "The DOI of the paper, for example 10.1038/s41586-020-2649-2.",
      },
    },
    required: ["doi"],
    additionalProperties: false,
  },
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}

function sanitizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function extractDomains(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .map((entry) => (typeof entry === "string" ? sanitizeDomain(entry) : null))
      .filter((entry): entry is string => entry != null),
  );
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RESULT_LIMIT;
  }

  const rounded = Math.trunc(value);
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, rounded));
}

function normalizeDoi(value: string): string {
  return value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
}

function resolveUnpaywallEmail(value?: string): string | null {
  const candidate = value ?? process.env.UNPAYWALL_EMAIL ?? process.env.UNPAYWALL_API_EMAIL;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : null;
}

function shouldUsePubMed(query: string, domains: string[]): boolean {
  if (domains.length > 0) {
    const allDomainsArePubMed = domains.every((domain) => PUBMED_DOMAINS.has(domain));
    if (!allDomainsArePubMed) {
      return false;
    }
  }

  return BIOLOGICAL_QUERY_PATTERN.test(query);
}

function formatToolFailure(message: string): DynamicToolResponse {
  return {
    contentItems: [
      {
        type: "inputText",
        text: `web_search failed: ${message}`,
      },
    ],
    success: false,
  };
}

function parseMarkdownLink(line: string): { text: string; url: string } | null {
  const match = line.match(/^\[([^\]]+)\]\((.+)\)$/);
  if (!match) {
    return null;
  }

  return {
    text: normalizeWhitespace(match[1] ?? ""),
    url: normalizeWhitespace(match[2] ?? ""),
  };
}

function isDisplayUrl(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

function isNoiseLink(text: string, url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return true;
  }

  if (/^learn more$/i.test(text) || /^report result$/i.test(text)) {
    return true;
  }

  return /support\.ecosia\.org|google\.com\/legal|ecosia\.org\/(accounts|browser|cookies|terms-of-service|help)/i.test(url);
}

function cleanTitle(text: string): string {
  return normalizeWhitespace(text.replace(/\s*-+\s*$/g, ""));
}

function isSnippetNoise(line: string): boolean {
  return (
    !line ||
    /^!?\[Image\b/i.test(line) ||
    /^This search result is provided by Google$/i.test(line) ||
    /^Search region:/i.test(line) ||
    /^News$/i.test(line) ||
    /^Navigation menu$/i.test(line)
  );
}

function normalizeSearchSection(markdown: string): string {
  const marker = "\nSearch\n======\n";
  const index = markdown.indexOf(marker);
  return index >= 0 ? markdown.slice(index + marker.length) : markdown;
}

export function parseEcosiaSearchMarkdown(markdown: string, limit = DEFAULT_RESULT_LIMIT): SearchResult[] {
  const lines = normalizeSearchSection(markdown).split(/\r?\n/);
  const results: SearchResult[] = [];
  let index = 0;
  let pendingDisplayUrl: string | null = null;

  while (index < lines.length && results.length < limit) {
    const line = lines[index]?.trim() ?? "";
    index += 1;
    if (!line) {
      continue;
    }

    const link = parseMarkdownLink(line);
    if (!link || isNoiseLink(link.text, link.url)) {
      continue;
    }

    if (isDisplayUrl(link.text)) {
      pendingDisplayUrl = link.url;
      continue;
    }

    const title = cleanTitle(link.text);
    if (!title) {
      pendingDisplayUrl = null;
      continue;
    }

    let snippet = "";
    while (index < lines.length) {
      const nextLine = lines[index]?.trim() ?? "";
      if (!nextLine) {
        index += 1;
        if (snippet) {
          break;
        }
        continue;
      }

      if (parseMarkdownLink(nextLine)) {
        break;
      }

      index += 1;
      if (isSnippetNoise(nextLine)) {
        continue;
      }

      snippet = normalizeWhitespace(`${snippet} ${nextLine}`);
      if (snippet.length >= 320) {
        snippet = snippet.slice(0, 317).trimEnd() + "...";
        break;
      }
    }

    results.push({
      title,
      url: pendingDisplayUrl ?? link.url,
      snippet,
    });
    pendingDisplayUrl = null;
  }

  return results;
}

function extractPubMedArticleId(record: PubMedSummaryRecord, idType: string): string | null {
  const match = record.articleids?.find((articleId) => articleId.idtype === idType);
  return match?.value?.trim() || null;
}

function formatPubMedAuthors(authors: PubMedSummaryAuthor[] | undefined): string {
  const names = authors?.map((author) => author.name?.trim()).filter((name): name is string => Boolean(name)) ?? [];
  if (names.length === 0) {
    return "unknown";
  }

  if (names.length <= 3) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")}, et al.`;
}

async function searchWithPubMed(query: string, limit: number, fetchImpl: typeof fetch): Promise<DynamicToolResponse> {
  const searchUrl = new URL(PUBMED_SEARCH_BASE_URL);
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(limit));
  searchUrl.searchParams.set("sort", "relevance");
  searchUrl.searchParams.set("tool", "codexbox");
  searchUrl.searchParams.set("term", query);

  const searchResponse = await fetchImpl(searchUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "codexbox/0.1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!searchResponse.ok) {
    throw new Error(`PubMed search returned ${searchResponse.status} ${searchResponse.statusText}`);
  }

  const searchData = (await searchResponse.json()) as PubMedSearchResponse;
  const pubMedIds = searchData.esearchresult?.idlist?.filter(Boolean) ?? [];
  if (pubMedIds.length === 0) {
    return {
      contentItems: [
        {
          type: "inputText",
          text: `No PubMed results found for "${query}".`,
        },
      ],
      success: true,
    };
  }

  const summaryUrl = new URL(PUBMED_SUMMARY_BASE_URL);
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("tool", "codexbox");
  summaryUrl.searchParams.set("id", pubMedIds.join(","));

  const summaryResponse = await fetchImpl(summaryUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "codexbox/0.1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!summaryResponse.ok) {
    throw new Error(`PubMed summary returned ${summaryResponse.status} ${summaryResponse.statusText}`);
  }

  const summaryData = (await summaryResponse.json()) as PubMedSummaryResponse;
  const lines = [`PubMed results for "${query}":`, ""];

  pubMedIds.forEach((pubMedId, resultIndex) => {
    const record = summaryData.result?.[pubMedId];
    if (!record || Array.isArray(record)) {
      return;
    }

    const title = normalizeWhitespace(record.title ?? "") || `PubMed article ${pubMedId}`;
    const journal = normalizeWhitespace(record.fulljournalname ?? "") || "unknown journal";
    const published = normalizeWhitespace(record.pubdate ?? "") || "unknown date";
    const authors = formatPubMedAuthors(record.authors);
    const doi = extractPubMedArticleId(record, "doi");

    lines.push(`${resultIndex + 1}. ${title}`);
    lines.push(`URL: https://pubmed.ncbi.nlm.nih.gov/${pubMedId}/`);
    lines.push(`PMID: ${pubMedId}`);
    lines.push(`Summary: ${journal}; ${published}; Authors: ${authors}${doi ? `; DOI: ${doi}` : ""}`);
    lines.push("");
  });

  return {
    contentItems: [
      {
        type: "inputText",
        text: lines.join("\n").trim(),
      },
    ],
    success: true,
  };
}

function selectUnpaywallPdfLocation(payload: UnpaywallResponse): { pdfUrl: string; landingPageUrl: string | null } | null {
  const locations = [
    payload.best_oa_location,
    ...(payload.oa_locations ?? []),
  ].filter((location): location is UnpaywallLocation => location != null);

  for (const location of locations) {
    const pdfUrl = location.url_for_pdf?.trim();
    if (pdfUrl) {
      return {
        pdfUrl,
        landingPageUrl: location.url?.trim() || null,
      };
    }
  }

  return null;
}

async function downloadOpenAccessPdf(
  argumentsValue: Record<string, unknown>,
  fetchImpl: typeof fetch,
  unpaywallEmail?: string,
): Promise<DynamicToolResponse> {
  const doi = typeof argumentsValue.doi === "string" ? normalizeDoi(argumentsValue.doi) : "";
  if (!doi) {
    return formatToolFailure("`doi` must be a non-empty string.");
  }

  const email = resolveUnpaywallEmail(unpaywallEmail);
  if (!email) {
    return formatToolFailure("UNPAYWALL_EMAIL is not configured.");
  }

  try {
    const lookupUrl = new URL(`${UNPAYWALL_BASE_URL}/${encodeURIComponent(doi)}`);
    lookupUrl.searchParams.set("email", email);

    const lookupResponse = await fetchImpl(lookupUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "codexbox/0.1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!lookupResponse.ok) {
      throw new Error(`Unpaywall lookup returned ${lookupResponse.status} ${lookupResponse.statusText}`);
    }

    const lookupPayload = (await lookupResponse.json()) as UnpaywallResponse;
    const pdfLocation = selectUnpaywallPdfLocation(lookupPayload);
    if (!pdfLocation) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: `No open-access PDF was available from Unpaywall for DOI ${doi}.`,
          },
        ],
        success: true,
      };
    }

    const pdfResponse = await fetchImpl(pdfLocation.pdfUrl, {
      headers: {
        Accept: "application/pdf, application/octet-stream;q=0.9, */*;q=0.1",
        "User-Agent": "codexbox/0.1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!pdfResponse.ok) {
      throw new Error(`PDF download returned ${pdfResponse.status} ${pdfResponse.statusText}`);
    }

    const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
    if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("downloaded file was not a PDF");
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-paper-"));
    const filename = `${sanitizeFilename(doi)}.pdf`;
    const savedPath = path.join(directory, filename);
    await fs.writeFile(savedPath, pdfBytes);

    const lines = [
      `Downloaded open-access PDF for DOI ${doi}.`,
      `Saved to: ${savedPath}`,
      `PDF URL: ${pdfLocation.pdfUrl}`,
    ];

    if (lookupPayload.title?.trim()) {
      lines.push(`Title: ${normalizeWhitespace(lookupPayload.title)}`);
    }
    if (lookupPayload.doi_url?.trim()) {
      lines.push(`DOI URL: ${lookupPayload.doi_url.trim()}`);
    }
    if (pdfLocation.landingPageUrl) {
      lines.push(`Landing page: ${pdfLocation.landingPageUrl}`);
    }

    return {
      contentItems: [
        {
          type: "inputText",
          text: lines.join("\n"),
        },
      ],
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatToolFailure(message);
  }
}

async function searchWithEcosia(
  query: string,
  domains: string[],
  limit: number,
  fetchImpl: typeof fetch,
): Promise<DynamicToolResponse> {
  const scopedQuery = domains.length > 0 ? `${query} ${domains.map((domain) => `site:${domain}`).join(" ")}` : query;
  const url = new URL(SEARCH_BACKEND_BASE_URL);
  url.searchParams.set("q", scopedQuery);

  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
      "User-Agent": "codexbox/0.1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`search backend returned ${response.status} ${response.statusText}`);
  }

  const markdown = await response.text();
  const results = parseEcosiaSearchMarkdown(markdown, limit);
  if (results.length === 0) {
    return {
      contentItems: [
        {
          type: "inputText",
          text: `No web results found for "${query}".`,
        },
      ],
      success: true,
    };
  }

  const lines = [`Search results for "${query}":`];
  if (domains.length > 0) {
    lines.push(`Domains: ${domains.join(", ")}`);
  }
  lines.push("");

  results.forEach((result, resultIndex) => {
    lines.push(`${resultIndex + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    if (result.snippet) {
      lines.push(`Summary: ${result.snippet}`);
    }
    lines.push("");
  });

  return {
    contentItems: [
      {
        type: "inputText",
        text: lines.join("\n").trim(),
      },
    ],
    success: true,
  };
}

async function executeWebSearch(argumentsValue: Record<string, unknown>, fetchImpl: typeof fetch): Promise<DynamicToolResponse> {
  const query = typeof argumentsValue.query === "string" ? argumentsValue.query.trim() : "";
  if (!query) {
    return formatToolFailure("`query` must be a non-empty string.");
  }

  const domains = extractDomains(argumentsValue.domains);
  const limit = clampLimit(argumentsValue.limit);

  try {
    if (shouldUsePubMed(query, domains)) {
      return await searchWithPubMed(query, limit, fetchImpl);
    }

    return await searchWithEcosia(query, domains, limit, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatToolFailure(message);
  }
}

export function getDynamicToolProfile(modelProvider?: string): string | null {
  return modelProvider === "ollama" ? OLLAMA_WEB_SEARCH_TOOL_PROFILE : null;
}

export function getDynamicToolsForProvider(modelProvider?: string): DynamicToolSpec[] {
  return getDynamicToolProfile(modelProvider) === OLLAMA_WEB_SEARCH_TOOL_PROFILE
    ? [OLLAMA_WEB_SEARCH_TOOL, DOWNLOAD_OPEN_ACCESS_PDF_TOOL]
    : [];
}

export async function executeDynamicToolCall(
  request: DynamicToolCallRequest,
  options?: {
    fetchImpl?: typeof fetch;
    unpaywallEmail?: string;
  },
): Promise<DynamicToolResponse> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const argumentsValue = request.arguments ?? {};

  if (request.tool === "web_search") {
    return executeWebSearch(argumentsValue, fetchImpl);
  }

  if (request.tool === "download_open_access_pdf") {
    return downloadOpenAccessPdf(argumentsValue, fetchImpl, options?.unpaywallEmail);
  }

  return formatToolFailure(`unsupported tool "${request.tool}"`);
}
