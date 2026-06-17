import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { render } from "./md";
import { normCode, READER_HOST, readerLink } from "./util";

// Anonymous MCP server. No per-connection state — every call is keyed by the
// reader code the user reads off their screen, so the same public endpoint
// serves everyone with zero setup beyond adding the URL to a Claude client.
export class Live extends McpAgent<Env, unknown, Record<string, never>> {
  server = new McpServer({ name: "live-reader", version: "0.1.0" });

  async init() {
    this.server.registerTool(
      "send_to_reader",
      {
        description:
          "Display long-form text on the user's e-reader (Kindle, Kobo, etc.) in real time, for comfortable reading on e-ink instead of the chat window. First ask the user for the 5-character code shown on their reader's screen (they get it by opening " +
          READER_HOST +
          " on the device). Then call this with that code and the full content as markdown. Call again with the same code to replace what's shown. Good for long answers, syntheses, drafts, or anything the user would rather read on a real reading device.",
        inputSchema: {
          code: z.string().describe("The 5-character code shown on the reader screen."),
          content: z.string().describe("The full text to display, as markdown."),
          title: z.string().optional().describe("Optional title; otherwise a leading '# heading' or 'Reading' is used."),
        },
      },
      async ({ code, content, title }) => {
        const c = normCode(code);
        if (c.length < 4) {
          return {
            content: [{ type: "text", text: `"${code}" doesn't look like a reader code. Ask the user for the 5-character code shown on their reader (open ${READER_HOST} on the device).` }],
            isError: true,
          };
        }
        const { title: t, html } = render(content, title);
        const stub = this.env.SESSION.get(this.env.SESSION.idFromName(c));
        const v = await stub.setDoc(html, t);
        return {
          content: [{ type: "text", text: `Sent to reader ${c} (update #${v}) — "${t}". It appears on the device within ~3s. Direct link: ${readerLink(c)}` }],
        };
      },
    );

    this.server.registerTool(
      "check_reader",
      {
        description: "Check whether an e-reader with the given code is currently connected and polling. Use to confirm pairing before sending.",
        inputSchema: { code: z.string().describe("The 5-character reader code.") },
      },
      async ({ code }) => {
        const c = normCode(code);
        const stub = this.env.SESSION.get(this.env.SESSION.idFromName(c));
        const s = await stub.status();
        const text = s.connected
          ? `Reader ${c} is connected${s.v ? ` (showing update #${s.v})` : " and waiting"}. Go ahead and send.`
          : `No reader is polling code ${c} right now. Ask the user to open ${READER_HOST} on their e-reader and read off the code shown.`;
        return { content: [{ type: "text", text }] };
      },
    );
  }
}
