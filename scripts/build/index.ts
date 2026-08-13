import { cpus } from "node:os";
import { join } from "node:path";
import { argv } from "node:process";

import {
    bench,
    highlight,
    logCompleted,
    logDebug,
    logFinished,
    logHeader,
    runTask,
} from "../common/statistics/print.ts";
import { TsWorker } from "../common/worker/index.ts";
import { isDev, previewLang } from "./lib/common.ts";
import { fixPluginLangs, makeLangDefs } from "./modules/lang.ts";
import { buildPlugin, listPlugins, workerResolves, workers } from "./modules/plugins.ts";

// Pass the target plugin name via CLI: e.g. `tsx build.ts my-plugin`
const targetPlugin = argv[2];

logDebug("Booting up Workers");

await (() =>
    new Promise<void>(res => {
        let count = 0;
        for (let i = 0; i < cpus().length; i++) {
            workers.push(
                new TsWorker(
                    join(import.meta.dirname, "modules/workers/plugins.ts"),
                    {
                        workerData: {
                            isDev,
                            previewLang,
                        },
                    },
                ).once("message", () => ++count >= workers.length && res()),
            );
        }
    }))();

const offset = performance.now();

// Write lang files

const writePluginLangFiles = bench();
logHeader("Writing plugin lang files");

await Promise.all([
    runTask(`Wrote ${highlight("defs.d.ts")} types file`, makeLangDefs()),
    // Pass targetPlugin so only that plugin's translations get fixed
    runTask(`Fixed ${highlight("plugin translation")} files`, fixPluginLangs(targetPlugin)),
]);

logFinished("writing plugin lang files", writePluginLangFiles.stop());

// Build plugins

const buildingPlugins = bench();
logHeader("Building plugins");

const allPlugins = await listPlugins();
const pluginsToBuild = targetPlugin 
    ? allPlugins.filter(p => (typeof p === "string" ? p : p.name) === targetPlugin)
    : allPlugins;

if (targetPlugin && pluginsToBuild.length === 0) {
    console.warn(`⚠️ Warning: Plugin "${targetPlugin}" was not found.`);
}

for (const plugin of pluginsToBuild) buildPlugin(plugin);

await (() =>
    new Promise<void>((res, rej) => {
        workerResolves.res = res as any;
        workerResolves.rej = rej as any;
    }))();

logFinished("building plugins", buildingPlugins.stop());

logCompleted(Math.floor(performance.now() - offset));

for (const worker of workers) worker.terminate();