import fs from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  executeDynamicToolCall,
  getDynamicToolProfile,
  getDynamicToolsForToolProfile,
  getDynamicToolsForProvider,
  parseEcosiaSearchMarkdown,
} from "../src/dynamic-tools.js";

const SAMPLE_SEARCH_MARKDOWN = `Title: Ecosia - the search engine that plants trees

URL Source: http://www.ecosia.org/search?q=ollama

Markdown Content:
ollama - Ecosia
===============

Search
======

[https://ollama.com](https://ollama.com/)

[Ollama ------](https://ollama.com/)

Ollama is the easiest way to automate your work using open models, while keeping your data safe.

[https://ollama.com/download](https://ollama.com/download)

[Download Ollama on Linux ------------------------](https://ollama.com/download)

Download Ollama. macOS Linux Windows.

[https://github.com/ollama/ollama](https://github.com/ollama/ollama)

[Ollama - GitHub ---------------](https://github.com/ollama/ollama)

Get started. ollama. You'll be prompted to run a model or connect Ollama to your existing agents.
`;

const SAMPLE_PUBMED_SEARCH_RESPONSE = {
  esearchresult: {
    idlist: ["12345", "67890"],
  },
};

const SAMPLE_PUBMED_SUMMARY_RESPONSE = {
  result: {
    uids: ["12345", "67890"],
    "12345": {
      uid: "12345",
      title: "BRCA1 controls DNA repair pathway choice",
      pubdate: "2024 Jan",
      fulljournalname: "Nature",
      authors: [{ name: "Kim A" }, { name: "Lee B" }, { name: "Park C" }, { name: "Choi D" }],
      articleids: [{ idtype: "doi", value: "10.1038/example-1" }],
    },
    "67890": {
      uid: "67890",
      title: "Genome-wide profiling of homologous recombination defects",
      pubdate: "2023 Sep",
      fulljournalname: "Cell",
      authors: [{ name: "Han E" }, { name: "Jung F" }],
      articleids: [{ idtype: "doi", value: "10.1016/example-2" }],
    },
  },
};

test("getDynamicToolsForProvider exposes web_search for ollama only", () => {
  assert.equal(getDynamicToolProfile("openai"), null);
  assert.equal(getDynamicToolProfile("ollama"), "ollama-research-tools-v2");
  assert.equal(getDynamicToolsForProvider("openai").length, 0);
  assert.equal(getDynamicToolsForProvider("ollama")[0]?.name, "web_search");
  assert.equal(getDynamicToolsForProvider("ollama")[1]?.name, "download_open_access_pdf");
  assert.equal(getDynamicToolsForToolProfile("ollama-research-tools-v2")[0]?.name, "web_search");
  assert.equal(getDynamicToolsForToolProfile("ollama-research-tools-v2")[1]?.name, "download_open_access_pdf");
  assert.equal(getDynamicToolsForToolProfile("unknown").length, 0);
});

test("parseEcosiaSearchMarkdown extracts result titles, urls, and snippets", () => {
  const results = parseEcosiaSearchMarkdown(SAMPLE_SEARCH_MARKDOWN, 3);

  assert.deepEqual(results, [
    {
      title: "Ollama",
      url: "https://ollama.com/",
      snippet: "Ollama is the easiest way to automate your work using open models, while keeping your data safe.",
    },
    {
      title: "Download Ollama on Linux",
      url: "https://ollama.com/download",
      snippet: "Download Ollama. macOS Linux Windows.",
    },
    {
      title: "Ollama - GitHub",
      url: "https://github.com/ollama/ollama",
      snippet: "Get started. ollama. You'll be prompted to run a model or connect Ollama to your existing agents.",
    },
  ]);
});

test("executeDynamicToolCall formats successful web search output", async () => {
  const response = await executeDynamicToolCall(
    {
      tool: "web_search",
      arguments: {
        query: "ollama",
        domains: ["ollama.com", "github.com"],
        limit: 2,
      },
    },
    {
      fetchImpl: async () =>
        new Response(SAMPLE_SEARCH_MARKDOWN, {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        }),
    },
  );

  assert.equal(response.success, true);
  assert.equal(response.contentItems[0]?.type, "inputText");
  assert.match((response.contentItems[0] as { text: string }).text, /Search results for "ollama":/);
  assert.match((response.contentItems[0] as { text: string }).text, /Domains: ollama\.com, github\.com/);
  assert.match((response.contentItems[0] as { text: string }).text, /1\. Ollama/);
  assert.doesNotMatch((response.contentItems[0] as { text: string }).text, /3\. Ollama - GitHub/);
});

test("executeDynamicToolCall routes biological queries to PubMed", async () => {
  const requests: string[] = [];
  const response = await executeDynamicToolCall(
    {
      tool: "web_search",
      arguments: {
        query: "BRCA1 mutation DNA repair biology",
        limit: 2,
      },
    },
    {
      fetchImpl: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("esearch.fcgi")) {
          return new Response(JSON.stringify(SAMPLE_PUBMED_SEARCH_RESPONSE), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        if (url.includes("esummary.fcgi")) {
          return new Response(JSON.stringify(SAMPLE_PUBMED_SUMMARY_RESPONSE), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }

        throw new Error(`unexpected url: ${url}`);
      },
    },
  );

  assert.equal(response.success, true);
  assert.equal(response.contentItems[0]?.type, "inputText");
  assert.match((response.contentItems[0] as { text: string }).text, /PubMed results for "BRCA1 mutation DNA repair biology":/);
  assert.match((response.contentItems[0] as { text: string }).text, /PMID: 12345/);
  assert.match((response.contentItems[0] as { text: string }).text, /DOI: 10\.1038\/example-1/);
  assert.match((response.contentItems[0] as { text: string }).text, /https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/12345\//);
  assert.equal(requests.some((request) => request.includes("esearch.fcgi")), true);
  assert.equal(requests.some((request) => request.includes("esummary.fcgi")), true);
  assert.equal(requests.some((request) => request.includes("ecosia.org")), false);
});

test("executeDynamicToolCall returns a failure payload for invalid input", async () => {
  const response = await executeDynamicToolCall({
    tool: "web_search",
    arguments: {
      query: "   ",
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.contentItems[0]?.type, "inputText");
  assert.match((response.contentItems[0] as { text: string }).text, /query/);
});

test("executeDynamicToolCall downloads an OA PDF for a DOI via Unpaywall", async () => {
  const response = await executeDynamicToolCall(
    {
      tool: "download_open_access_pdf",
      arguments: {
        doi: "10.1038/example-doi",
      },
    },
    {
      unpaywallEmail: "bot@example.com",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.startsWith("https://api.unpaywall.org/v2/")) {
          return new Response(
            JSON.stringify({
              doi: "10.1038/example-doi",
              doi_url: "https://doi.org/10.1038/example-doi",
              title: "Example open paper",
              best_oa_location: {
                url: "https://repository.example/paper",
                url_for_pdf: "https://repository.example/paper.pdf",
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          );
        }

        if (url === "https://repository.example/paper.pdf") {
          return new Response(Buffer.from("%PDF-1.4\nexample pdf"), {
            status: 200,
            headers: {
              "content-type": "application/pdf",
            },
          });
        }

        throw new Error(`unexpected url: ${url}`);
      },
    },
  );

  assert.equal(response.success, true);
  assert.equal(response.contentItems[0]?.type, "inputText");
  const text = (response.contentItems[0] as { text: string }).text;
  assert.match(text, /Downloaded open-access PDF for DOI 10\.1038\/example-doi/);
  assert.match(text, /Saved to: /);
  assert.match(text, /PDF URL: https:\/\/repository\.example\/paper\.pdf/);

  const savedPathMatch = text.match(/Saved to: (.+)/);
  assert.ok(savedPathMatch?.[1]);
  const savedPath = savedPathMatch?.[1]?.trim() ?? "";
  const savedBytes = await fs.readFile(savedPath);
  assert.equal(savedBytes.subarray(0, 5).toString("utf8"), "%PDF-");
  await fs.rm(path.dirname(savedPath), { recursive: true, force: true });
});

test("executeDynamicToolCall requires an Unpaywall email for DOI downloads", async () => {
  const response = await executeDynamicToolCall({
    tool: "download_open_access_pdf",
    arguments: {
      doi: "10.1038/example-doi",
    },
  });

  assert.equal(response.success, false);
  assert.equal(response.contentItems[0]?.type, "inputText");
  assert.match((response.contentItems[0] as { text: string }).text, /UNPAYWALL_EMAIL/);
});
