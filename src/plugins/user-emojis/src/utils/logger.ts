import { storage } from "@vendetta/plugin";

export const PLUGIN_TAG = "[UserEmojiPicker]";

export function logStatus(message: string, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}`;

    if (!storage.debugLogs) storage.debugLogs = [];
    storage.debugLogs.unshift(formatted);
    if (storage.debugLogs.length > 40) storage.debugLogs.pop();

    if (isError) {
        console.error(`${PLUGIN_TAG} 🔴 ${message}`);
    } else {
        console.log(`${PLUGIN_TAG} 🟢 ${message}`);
    }
}
