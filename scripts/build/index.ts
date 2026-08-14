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

// Read the targeted plugin from CLI args (e.g. `tsx build.ts "user-emojis"`)
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

// 1. Write lang files

const writePluginLangFiles = bench();
logHeader("Writing plugin lang files");

await Promise.all([
    runTask(`Wrote ${highlight("defs.d.ts")} types file`, makeLangDefs()),
    runTask(`Fixed ${highlight("plugin translation")} files`, fixPluginLangs(targetPlugin ? [targetPlugin] : [])),
]);

logFinished("writing plugin lang files", writePluginLangFiles.stop());

// 2. Build targeted plugin(s)

const buildingPlugins = bench();
logHeader("Building plugins");

const allPlugins = await listPlugins();

// Robust matching: Check plugin folder path, manifest ID, or name
const pluginsToBuild = targetPlugin 
    ? allPlugins.filter(p => {
        const name = typeof p === "string" ? p : p.name;
        const id = typeof p === "string" ? p : ((p as any).id || (p as any).dir || (p as any).path);
        
        const target = targetPlugin.toLowerCase();
        return (
            name?.toLowerCase() === target ||
            id?.toLowerCase().endsWith(target) ||
            id?.toLowerCase() === target
        );
    })
    : allPlugins;

if (targetPlugin && pluginsToBuild.length === 0) {
    console.warn(`\n⚠️  Warning: Could not find plugin matching "${targetPlugin}". Available plugins:`);
    console.warn(allPlugins.map(p => typeof p === "string" ? p : p.name).join(", "));
} else {
    for (const plugin of pluginsToBuild) {
        buildPlugin(plugin);
    }
}

await (() =>
    new Promise<void>((res, rej) => {
        workerResolves.res = res as any;
        workerResolves.rej = rej as any;
    }))();

logFinished("building plugins", buildingPlugins.stop());

// README writing section completely omitted

logCompleted(Math.floor(performance.now() - offset));

for (const worker of workers) worker.terminate();