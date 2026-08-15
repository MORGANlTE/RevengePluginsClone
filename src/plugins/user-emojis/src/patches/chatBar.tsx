import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { logStatus } from "../utils/logger";
import { openEmojiModal } from "../utils/navigation";

export function patchChatBar(): () => void {
    const unpatches: (() => void)[] = [];

    // 1. Injects into the "+" Attachment Sheet Actions
    const chatInputActions = findByProps("useChatInputActions") || findByName("useChatInputActions", false);
    if (chatInputActions?.default) {
        unpatches.push(
            after("default", chatInputActions, (args, res) => {
                if (!res || !Array.isArray(res)) return;
                res.unshift({
                    icon: getAssetIDByName("ic_shop_24px") ?? getAssetIDByName("ShopIcon"),
                    label: "Emoji Store",
                    action: openEmojiModal,
                });
            })
        );
        logStatus("Patched useChatInputActions (+ attach menu)");
    } else {
        logStatus("useChatInputActions not found, skipping hook");
    }

    // 2. Injects inline button into ChatAccessories / ChatInput bar
    const chatInputMod =
        findByName("ChatAccessories", false) ||
        findByName("ChatInput", false) ||
        findByProps("ChatAccessories") ||
        findByProps("ChatInput", "renderChatInput");

    if (chatInputMod) {
        const targetProp = chatInputMod.default
            ? "default"
            : chatInputMod.ChatInput
            ? "ChatInput"
            : chatInputMod.renderChatInput
            ? "renderChatInput"
            : typeof chatInputMod === "function"
            ? "render"
            : null;

        const modTarget = targetProp ? chatInputMod : chatInputMod;
        const fnName = targetProp || Object.keys(chatInputMod).find((k) => typeof chatInputMod[k] === "function");

        if (fnName && typeof modTarget[fnName] === "function") {
            unpatches.push(
                after(fnName, modTarget, (_, res) => {
                    if (!res || !res.props) return res;

                    const btn = (
                        <RN.TouchableOpacity
                            key="user-emoji-store-bar-btn"
                            onPress={openEmojiModal}
                            style={{
                                justifyContent: "center",
                                alignItems: "center",
                                paddingHorizontal: 6,
                            }}
                        >
                            <RN.Text style={{ fontSize: 18 }}>💎</RN.Text>
                        </RN.TouchableOpacity>
                    );

                    if (Array.isArray(res.props.children)) {
                        if (!res.props.children.some((c: any) => c?.key === "user-emoji-store-bar-btn")) {
                            res.props.children.unshift(btn);
                        }
                    }
                    return res;
                })
            );
            logStatus("Patched Chat accessory bar inline 💎 button");
        }
    } else {
        logStatus("Chat accessory bar component not found", true);
    }

    return () => unpatches.forEach((u) => u?.());
}
