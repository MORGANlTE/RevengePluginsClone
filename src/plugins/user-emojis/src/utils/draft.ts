import { findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { AppEmoji } from "../types";
import { SelectedChannelStore } from "./botApi";
import { logStatus, PLUGIN_TAG } from "./logger";
import { closeEmojiModal } from "./navigation";

export const DraftStore = findByStoreName("DraftStore");
export const DraftActions = findByProps("saveDraft", "setDraft", "updateDraft");
export const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
export const TextUtils = findByProps("insertText");

export function transformDraftText(text: string): string {
    if (typeof text !== "string" || !storage.emojis?.length) return text;
    const emojiMap = new Map(storage.emojis.map((e: AppEmoji) => [e.name.toLowerCase(), e]));

    return text.replace(
        /(?<!<a?:[A-Za-z0-9_]+:\d+)(?::([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);)/g,
        (match, colon, semi) => {
            const raw = (colon || semi || "").toLowerCase();
            const found = emojiMap.get(raw);
            if (found) {
                return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
            }
            return match;
        }
    );
}

export function insertEmojiIntoDraft(emoji: AppEmoji) {
    const channelId = SelectedChannelStore?.getChannelId();
    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}> `;
    let inserted = false;

    // Strategy 1: ComponentDispatch event
    try {
        if (ComponentDispatch?.dispatchToLastSubscribed) {
            ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                plainText: tag,
                rawText: tag,
            });
            inserted = true;
        } else if (ComponentDispatch?.dispatch) {
            ComponentDispatch.dispatch("INSERT_TEXT", {
                plainText: tag,
                rawText: tag,
            });
            inserted = true;
        }
    } catch {}

    // Strategy 2: DraftStore state injection
    if (!inserted && channelId && DraftActions && DraftStore) {
        try {
            const currentDraft = DraftStore.getDraft(channelId, 0) || "";
            const updated = (currentDraft ? currentDraft.trimEnd() + " " : "") + tag;
            if (typeof DraftActions.saveDraft === "function") {
                DraftActions.saveDraft(channelId, updated, 0);
                inserted = true;
            } else if (typeof DraftActions.setDraft === "function") {
                DraftActions.setDraft(channelId, updated, 0);
                inserted = true;
            }
        } catch {}
    }

    // Strategy 3: TextUtils
    if (!inserted && TextUtils?.insertText) {
        try {
            TextUtils.insertText(tag);
            inserted = true;
        } catch {}
    }

    // Fallback: Clipboard
    if (!inserted) {
        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
        logStatus(`Clipboard fallback used for :${emoji.name}:`);
    } else {
        logStatus(`Inserted :${emoji.name}: into draft`);
    }

    closeEmojiModal();
}
