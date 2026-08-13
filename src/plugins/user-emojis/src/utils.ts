import { findByStoreName, findByProps } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

// 1. Reliably locate the Store and Channel ID functions
const DraftStore = findByStoreName("DraftStore");
// We search for multiple known props to ensure we grab the right module
const channelStore = findByProps("getChannelId", "getVoiceChannelId");

export function insertTextIntoChat(textToInsert: string) {
    if (!channelStore || !DraftStore) {
        showToast("Failed to locate required Discord stores.");
        return;
    }

    const channelId = channelStore.getChannelId();
    if (!channelId) {
        showToast("No active channel found.");
        return;
    }

    // 2. Fetch the current text in the chat bar (draftType 0 is standard chat)
    const currentDraft = DraftStore.getDraft(channelId, 0) || "";
    const newDraft = currentDraft + textToInsert;

    // 3. Dispatch directly to Flux. 
    // We cast to `as any` to bypass the type checker, as it expects strictly typed actions,
    // but Discord's internal reducers will accept this raw payload perfectly.
    FluxDispatcher.dispatch({
        type: "DRAFT_SAVE",
        channelId: channelId,
        draft: newDraft,
        draftType: 0,
        clearStorage: false // Required by some newer Discord versions to prevent dropping state
    } as any); 
}
