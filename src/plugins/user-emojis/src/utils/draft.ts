import { findByProps, findByStoreName } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { AppEmoji } from "../types";
import { SelectedChannelStore } from "./botApi";
import { logStatus, PLUGIN_TAG } from "./logger";

export const DraftStore = findByStoreName("DraftStore");
export const DraftActions = findByProps("saveDraft", "setDraft", "updateDraft");
export const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
export const TextUtils = findByProps("insertText");

let activeChatInputRef: any = null;

export function setActiveChatInputRef(ref: any) {
    if (ref) activeChatInputRef = ref;
}

export function getActiveChatInputRef(): any {
    return activeChatInputRef;
}

export function transformDraftText(text: string): string {
    const list: AppEmoji[] = storage.emojis || [];
    if (typeof text !== "string" || !list.length) return text;
    const emojiMap = new Map<string, AppEmoji>(list.map((e: AppEmoji) => [e.name.toLowerCase(), e]));

    // Step 1: Replace semicolon shortcuts (;name;)
    let result = text.replace(/;([A-Za-z0-9_]+);/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        if (found) {
            return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
        }
        return match;
    });

    // Step 2: Replace colon shortcuts (:name:) ONLY if not already inside a Discord tag <a:name:id>
    result = result.replace(/(?<!<a?):([A-Za-z0-9_]+):(?!\d+>)/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        if (found) {
            return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
        }
        return match;
    });

    return result;
}

export function insertEmojiIntoDraft(emoji: AppEmoji) {
    const channelId = SelectedChannelStore?.getChannelId();
    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}> `;
    let inserted = false;

    // Strategy 1: Active Chat Input Ref (Updates the live visual text input in Discord chat)
    const inputRef = activeChatInputRef?.current || activeChatInputRef;
    if (inputRef && typeof inputRef.handleTextChanged === "function") {
        try {
            const currentText = typeof inputRef.getText === "function"
                ? inputRef.getText()
                : (DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "");
            const updated = (currentText ? currentText.trimEnd() + " " : "") + tag;
            inputRef.handleTextChanged(updated);
            inserted = true;
        } catch {}
    }

    // Strategy 2: DraftStore & DraftActions
    if (channelId && (DraftActions || DraftStore)) {
        try {
            const currentDraft = DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "";
            const updated = (currentDraft ? currentDraft.trimEnd() + " " : "") + tag;
            if (typeof DraftActions?.saveDraft === "function") {
                DraftActions.saveDraft(channelId, updated, 0);
                inserted = true;
            } else if (typeof DraftActions?.setDraft === "function") {
                DraftActions.setDraft(channelId, updated, 0);
                inserted = true;
            } else if (typeof DraftActions?.updateDraft === "function") {
                DraftActions.updateDraft(channelId, updated, 0);
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

    // Strategy 4: ComponentDispatch event
    if (!inserted) {
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
    }

    // Fallback: Clipboard
    if (!inserted) {
        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
        logStatus(`Clipboard fallback used for :${emoji.name}:`);
    } else {
        showToast(`${PLUGIN_TAG} Added :${emoji.name}:`, 1);
        logStatus(`Inserted :${emoji.name}: into draft`);
    }
}
