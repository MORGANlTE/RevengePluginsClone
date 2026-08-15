import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { logStatus } from "../utils/logger";
import { openEmojiModal } from "../utils/navigation";

export function patchChatBar(): () => void {
    const unpatches: (() => void)[] = [];

    // 1. Injects button into ChatInputGuardWrapper (Primary on modern Discord Mobile)
    const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
    if (ChatInputGuardWrapper) {
        unpatches.push(
            after("default", ChatInputGuardWrapper, (_, ret) => {
                if (!ret?.props?.children) return;

                const btn = (
                    <RN.TouchableOpacity
                        key="user-emoji-store-bar-btn"
                        onPress={openEmojiModal}
                        activeOpacity={0.7}
                        style={{
                            height: 34,
                            width: 34,
                            borderRadius: 17,
                            marginHorizontal: 4,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(88, 101, 242, 0.15)",
                        }}
                    >
                        <RN.Text style={{ fontSize: 18 }}>💎</RN.Text>
                    </RN.TouchableOpacity>
                );

                const viewChildren = findInReactTree(
                    ret.props.children,
                    (x) => x?.type?.displayName === "View" && Array.isArray(x.props?.children)
                )?.props?.children;

                if (Array.isArray(viewChildren)) {
                    if (!viewChildren.some((c: any) => c?.key === "user-emoji-store-bar-btn")) {
                        viewChildren.unshift(btn);
                    }
                } else {
                    const native = findInReactTree(
                        ret,
                        (x) => x?.props?.children?.[0]?.type?.displayName === "ChatInputNativeComponent"
                    );
                    if (native && Array.isArray(native.props?.children)) {
                        if (!native.props.children.some((c: any) => c?.key === "user-emoji-store-bar-btn")) {
                            native.props.children.push(btn);
                        }
                    }
                }
            })
        );
        logStatus("Patched ChatInputGuardWrapper chat bar 💎 button");
    }

    // 2. Injects into the "+" Attachment Sheet Actions (useChatInputActions)
    const chatInputActions =
        findByProps("useChatInputActions") || findByName("useChatInputActions", false);
    if (chatInputActions) {
        const fn = chatInputActions.default ? "default" : "useChatInputActions";
        if (typeof chatInputActions[fn] === "function") {
            unpatches.push(
                after(fn, chatInputActions, (args, res) => {
                    if (!res || !Array.isArray(res)) return;
                    if (!res.some((a: any) => a?.label === "Custom Emojis" || a?.label === "Emoji Store")) {
                        res.unshift({
                            icon:
                                getAssetIDByName("ic_shop_24px") ??
                                getAssetIDByName("ShopIcon") ??
                                getAssetIDByName("SmileIcon"),
                            label: "Custom Emojis",
                            action: openEmojiModal,
                        });
                    }
                })
            );
            logStatus("Patched useChatInputActions (+ attach menu)");
        }
    }

    // 3. Fallback: ChatAccessories / ChatInput bar
    const chatInputMod =
        findByName("ChatAccessories", false) ||
        findByName("ChatInput", false) ||
        findByProps("ChatAccessories");

    if (chatInputMod) {
        const fnName = chatInputMod.default
            ? "default"
            : Object.keys(chatInputMod).find((k) => typeof chatInputMod[k] === "function");

        if (fnName && typeof chatInputMod[fnName] === "function") {
            unpatches.push(
                after(fnName, chatInputMod, (_, res) => {
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
            logStatus("Patched ChatAccessories fallback");
        }
    }

    return () => unpatches.forEach((u) => u?.());
}
