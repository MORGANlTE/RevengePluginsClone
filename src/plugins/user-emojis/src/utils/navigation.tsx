import { ActionSheet, hideActionSheet } from "$/components/ActionSheet";
import { showToast } from "@vendetta/ui/toasts";
import EmojiStoreModal from "../ui/EmojiStoreModal";
import { logStatus, PLUGIN_TAG } from "./logger";

type DrawerToggleFn = (updater: boolean | ((prev: boolean) => boolean)) => void;

let drawerToggleFn: DrawerToggleFn | null = null;
let isDrawerOpen = false;

export function registerDrawerToggle(fn: DrawerToggleFn | null) {
    drawerToggleFn = fn;
}

export function setDrawerOpenState(open: boolean) {
    isDrawerOpen = open;
}

export function getIsDrawerOpen(): boolean {
    return isDrawerOpen;
}

export function closeEmojiModal() {
    if (drawerToggleFn && isDrawerOpen) {
        drawerToggleFn(false);
        return;
    }
    try {
        hideActionSheet();
    } catch (e) {
        logStatus(`Error closing emoji modal: ${String(e)}`, true);
    }
}

export function toggleEmojiStore() {
    if (drawerToggleFn) {
        drawerToggleFn((prev) => !prev);
        logStatus("Toggled inline Emoji Drawer");
        return;
    }
    openEmojiModal();
}

export function openEmojiStore() {
    if (drawerToggleFn) {
        drawerToggleFn(true);
        logStatus("Opened inline Emoji Drawer");
        return;
    }
    openEmojiModal();
}

export function openEmojiModal() {
    try {
        ActionSheet.open(EmojiStoreModal, undefined);
        logStatus("Opened Custom Emoji Store modal");
    } catch (e) {
        logStatus(`openEmojiModal error: ${String(e)}`, true);
        showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
    }
}
