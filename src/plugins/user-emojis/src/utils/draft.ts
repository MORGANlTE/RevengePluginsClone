import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { findInReactTree } from "@vendetta/utils";
import { AppEmoji } from "../types";
import { buildEmojiObj, SelectedChannelStore } from "./botApi";
import { logStatus, PLUGIN_TAG } from "./logger";

export const DraftStore = findByStoreName("DraftStore");
export const DraftActions = findByProps("saveDraft", "setDraft", "updateDraft");
export const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
export const TextUtils = findByProps("insertText");

let activeChatInputRef: any = null;

export function extractChatInputRef(tree: any): any {
    if (!tree) return null;
    const node = findInReactTree(
        tree,
        (x) => x?.chatInputRef?.current || x?.props?.chatInputRef?.current || x?.chatInputRef || x?.props?.chatInputRef
    );
    if (!node) return null;
    return node.chatInputRef || node.props?.chatInputRef || node;
}

export function setActiveChatInputRef(ref: any) {
    if (ref) {
        activeChatInputRef = ref;
    }
}

export function getActiveChatInputRef(): any {
    return activeChatInputRef;
}

export function transformDraftText(text: string): string {
    const list: AppEmoji[] = storage.emojis || [];
    if (typeof text !== "string" || !list.length) return text;
    const emojiMap = new Map<string, AppEmoji>(list.map((e: AppEmoji) => [e.name.toLowerCase(), e]));

    return text.replace(
        /(<a?:([A-Za-z0-9_]+):(\d+)>)|;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):/g,
        (match, fullTag, tagEmojiName, tagEmojiId, semiName, colonName) => {
            if (fullTag) return fullTag;
            const name = (tagEmojiName || semiName || colonName || "").toLowerCase();
            const found = emojiMap.get(name);
            if (found) {
                return `<${found.animated ? "a" : ""}:${found.name}:${found.id}> `;
            }
            return match;
        }
    );
}

export function insertEmojiIntoDraft(emoji: AppEmoji, customRef?: any) {
    const channelId = SelectedChannelStore?.getChannelId();
    // Full tag prevents Discord's emoticon replacer from turning custom emojis (like :wink:) into standard Unicode 😉
    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}> `;
    const emojiObj = buildEmojiObj(emoji);
    let inserted = false;

    const ref = customRef?.current ? customRef : (getActiveChatInputRef() || customRef);
    const inputTarget = ref?.current || ref;

    // 1. Direct Target Methods on chatInputRef
    if (inputTarget) {
        try {
            const currentText = typeof inputTarget.getText === "function"
                ? inputTarget.getText()
                : (DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "");
            const updated = (currentText ? currentText.trimEnd() + " " : "") + tag;

            if (typeof inputTarget.insertText === "function") {
                inputTarget.insertText(tag);
                inserted = true;
            }

            if (typeof inputTarget.handleTextChanged === "function") {
                inputTarget.handleTextChanged(updated);
                inserted = true;
            }
            if (typeof inputTarget.props?.onChangeText === "function") {
                inputTarget.props.onChangeText(updated);
                inserted = true;
            }
            if (typeof inputTarget.setText === "function") {
                inputTarget.setText(updated);
                inserted = true;
            }
            if (typeof inputTarget.setValue === "function") {
                inputTarget.setValue(updated);
                inserted = true;
            }

            const inner = inputTarget.ref?.current || inputTarget._nativeRef;
            if (inner) {
                if (typeof inner.insertText === "function") {
                    inner.insertText(tag);
                    inserted = true;
                }
                if (typeof inner.handleTextChanged === "function") {
                    inner.handleTextChanged(updated);
                    inserted = true;
                }
                if (typeof inner.setNativeProps === "function") {
                    inner.setNativeProps({ text: updated });
                    inserted = true;
                }
            }
        } catch (e) {
            logStatus(`Input target update error: ${String(e)}`, true);
        }
    }

    // 2. ComponentDispatch Events
    try {
        if (ComponentDispatch?.dispatchToLastSubscribed) {
            ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { plainText: tag, rawText: tag });
            inserted = true;
        } else if (ComponentDispatch?.dispatch) {
            ComponentDispatch.dispatch("INSERT_TEXT", { plainText: tag, rawText: tag });
            inserted = true;
        }
    } catch {}

    // 3. TextUtils insertText
    if (!inserted && TextUtils?.insertText) {
        try {
            TextUtils.insertText(tag);
            inserted = true;
        } catch {}
    }

    // 4. FluxDispatcher & DraftStore Synchronization
    if (channelId) {
        try {
            const currentDraft = DraftStore?.getDraft ? DraftStore.getDraft(channelId, 0) || "" : "";
            const updated = (currentDraft ? currentDraft.trimEnd() + " " : "") + tag;

            if (typeof DraftActions?.saveDraft === "function") {
                DraftActions.saveDraft(channelId, updated, 0);
            }
            if (typeof DraftActions?.setDraft === "function") {
                DraftActions.setDraft(channelId, updated, 0);
            }
            if (typeof DraftActions?.updateDraft === "function") {
                DraftActions.updateDraft(channelId, updated, 0);
            }

            FluxDispatcher.dispatch({
                type: "DRAFT_CHANGE",
                channelId,
                draft: updated,
                draftType: 0,
            });
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
