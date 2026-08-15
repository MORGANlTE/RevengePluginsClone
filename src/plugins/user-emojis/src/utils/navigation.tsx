import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { logStatus, PLUGIN_TAG } from "./logger";

export const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
export const ModalActions = findByProps("popModal", "pushModal");
export const AlertActions = findByProps("dismissAlert", "openAlert");

export function closeEmojiModal() {
    try {
        if (LazyActionSheet?.hideActionSheet) LazyActionSheet.hideActionSheet();
        const sheetMod = findByProps("hideActionSheet");
        if (sheetMod?.hideActionSheet) sheetMod.hideActionSheet();
        if (ModalActions?.popModal) ModalActions.popModal("CustomEmojiStoreSheet");
        if (AlertActions?.dismissAlert) AlertActions.dismissAlert();
    } catch (e) {
        logStatus(`Error closing emoji modal: ${String(e)}`, true);
    }
}

export function openEmojiModal() {
    try {
        if (LazyActionSheet?.openLazy) {
            const { EmojiStoreModal } = require("../ui/EmojiStoreModal");
            LazyActionSheet.openLazy(
                async () => () => <EmojiStoreModal />,
                "CustomEmojiStoreSheet"
            );
            logStatus("Opened Emoji Store ActionSheet");
        } else {
            showToast(`${PLUGIN_TAG} ActionSheet module unavailable`, 2);
            logStatus("ActionSheet openLazy module not found", true);
        }
    } catch (e) {
        logStatus(`openEmojiModal error: ${String(e)}`, true);
    }
}
