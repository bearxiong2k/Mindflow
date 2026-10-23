import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

function mindflowBrowserFixture() {
  return {
    name: "mindflow-browser-fixture",
    configureServer(server: {
      middlewares: {
        use: (
          path: string,
          handler: (
            request: { url?: string },
            response: {
              statusCode: number;
              setHeader: (name: string, value: string) => void;
              end: (body: string) => void;
            },
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use("/__mindflow_fixture_qc_history", async (request, response) => {
        try {
          const url = new URL(request.url ?? "", "http://mindflow.local");
          const cwd = new URL("..", import.meta.url).pathname;
          const output = await execute("cargo", ["run", "--quiet", "--bin", "mindflow", "--", "qc", "--list-commits", "--offset", url.searchParams.get("offset") ?? "0", "--json"], { cwd, maxBuffer: 8 * 1024 * 1024 });
          response.setHeader("Content-Type", "application/json");
          response.end(output.stdout);
        } catch (error) {
          response.statusCode = 500;
          response.end(String(error));
        }
      });
      server.middlewares.use("/__mindflow_fixture_qc", async (request, response) => {
        try {
          const url = new URL(request.url ?? "", "http://mindflow.local");
          const selection = url.searchParams.has("from")
            ? ["--from", url.searchParams.get("from")!, "--to", url.searchParams.get("to") ?? "working-tree"]
            : ["--commits", url.searchParams.get("commits") ?? "30"];
          const cwd = new URL("..", import.meta.url).pathname;
          const output = await execute("cargo", ["run", "--quiet", "--bin", "mindflow", "--", "qc", ...selection, "--json"], { cwd, maxBuffer: 8 * 1024 * 1024 });
          response.setHeader("Content-Type", "application/json");
          response.end(output.stdout);
        } catch (error) {
          response.statusCode = 500;
          response.end(String(error));
        }
      });
      server.middlewares.use("/__mindflow_fixture_versions", async (_request, response) => {
        try {
          const cwd = new URL("..", import.meta.url).pathname;
          const output = await execute("cargo", ["run", "--quiet", "--bin", "mindflow", "--", "version", "--json"], { cwd });
          const report = JSON.parse(output.stdout);
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({
            app: { release: report.runtime.release, variant: "development" },
            local_core: report.runtime,
            project_core: report.runtime,
            project: report.project,
            local_update: { status: "unknown" },
          }));
        } catch (error) {
          response.statusCode = 500;
          response.end(String(error));
        }
      });
      server.middlewares.use("/__mindflow_fixture", async (_request, response) => {
        try {
          const cwd = new URL("..", import.meta.url).pathname;
          const [statusOutput, graphOutput, openingOutput] = await Promise.all([
            execute(
              "cargo",
              ["run", "--quiet", "--bin", "mindflow", "--", "status", "--json"],
              { cwd },
            ),
            execute(
              "cargo",
              ["run", "--quiet", "--bin", "mindflow", "--", "graph"],
              { cwd },
            ),
            execute(
              "cargo",
              [
                "run",
                "--quiet",
                "--bin",
                "mindflow",
                "--",
                "opening",
                "show",
                "--json",
              ],
              { cwd },
            ),
          ]);
          const current = JSON.parse(statusOutput.stdout);
          const region = {
            root: current.status.root,
            project: "Mindflow",
            slice: "working-tree",
            status: current.status,
            graph: JSON.parse(graphOutput.stdout),
            opening: JSON.parse(openingOutput.stdout),
            anchor_timeline: [],
            timeline_commits: [],
          };
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify([[{ status: "region", region }]]));
        } catch (error) {
          response.statusCode = 500;
          response.end(String(error));
        }
      });
      server.middlewares.use(
        "/__mindflow_fixture_directory",
        async (request, response) => {
          try {
            const root = resolve(new URL("..", import.meta.url).pathname);
            const requestUrl = new URL(
              request.url ?? "",
              "http://mindflow.local",
            );
            const path = requestUrl.searchParams.get("path") ?? "";
            const directory = resolve(root, path);
            const bounded = relative(root, directory);
            if (bounded.startsWith(`..${sep}`) || bounded === "..") {
              throw new Error("Fixture path leaves the project root");
            }
            const entries = (await readdir(directory, { withFileTypes: true }))
              .flatMap((entry) => {
                if (entry.name === ".git") return [];
                const kind = entry.isDirectory()
                  ? "directory"
                  : entry.isFile()
                    ? "file"
                    : undefined;
                if (!kind) return [];
                return [
                  {
                    kind,
                    name: entry.name,
                    path: path ? `${path}/${entry.name}` : entry.name,
                  },
                ];
              })
              .sort(
                (left, right) =>
                  Number(left.kind === "file") - Number(right.kind === "file") ||
                  left.name.localeCompare(right.name),
              );
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ entries, path }));
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error));
          }
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), mindflowBrowserFixture()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
