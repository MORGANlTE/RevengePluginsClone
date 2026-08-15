import { ActionSheet, hideActionSheet } from "$/components/ActionSheet";
import { showToast } from "@vendetta/ui/toasts";
import EmojiStoreModal from "../ui/EmojiStoreModal";
import { logStatus, PLUGIN_TAG } from "./logger";

export function closeEmojiModal() {
    try {
        hideActionSheet();
    } catch (e) {
        logStatus(`Error closing emoji modal: ${String(e)}`, true);
    }
}

export function openEmojiModal() {
    try {
        ActionSheet.open(EmojiStoreModal, undefined);
        logStatus("Opened Custom Emoji Store");
    } catch (e) {
        logStatus(`openEmojiModal error: ${String(e)}`, true);
        showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
    }
}
