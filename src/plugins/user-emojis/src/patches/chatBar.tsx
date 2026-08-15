import { findByName, findByProps, findByTypeName } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { setActiveChatInputRef, transformDraftText } from "../utils/draft";
import { logStatus } from "../utils/logger";
import { openEmojiModal } from "../utils/navigation";

export function patchChatBar(): () => void {
    const unpatches: (() => void)[] = [];
    const patchedRefs = new WeakSet();

    function hookInputRef(refObj: any) {
        if (!refObj) return;
        const target = refObj.current || refObj;
        setActiveChatInputRef(refObj);

        if (target && typeof target.handleTextChanged === "function" && !patchedRefs.has(target)) {
            patchedRefs.add(target);
            unpatches.push(
                before("handleTextChanged", target, (args) => {
                    if (typeof args[0] === "string") {
                        const transformed = transformDraftText(args[0]);
                        if (transformed !== args[0]) {
                            args[0] = transformed;
                        }
                    }
                })
            );
            logStatus("Hooked handleTextChanged for live chatbar emoji preview");
        }
    }

    // 1. Injects button and hooks input into ChatInputGuardWrapper
    const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
    if (ChatInputGuardWrapper) {
        unpatches.push(
            after("default", ChatInputGuardWrapper, (_, ret) => {
                if (!ret?.props?.children) return;

                const inputProps = findInReactTree(
                    ret,
                    (x) => x?.chatInputRef || x?.props?.chatInputRef?.current || x?.props?.chatInputRef
                );
                if (inputProps) {
                    hookInputRef(inputProps.chatInputRef || inputProps.props?.chatInputRef || inputProps);
                }

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
        logStatus("Patched ChatInputGuardWrapper for live preview & 💎 button");
    }

    // 2. ChatView hook for chatInputRef fallback
    const ChatView = findByTypeName("ChatView");
    if (ChatView) {
        unpatches.push(
            after("type", ChatView, ([{ chatInputRef }]) => {
                if (chatInputRef) hookInputRef(chatInputRef);
            })
        );
    }

    // 3. Injects into the "+" Attachment Sheet Actions (useChatInputActions)
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

    // 4. Fallback: ChatAccessories / ChatInput bar
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
        }
    }

    return () => unpatches.forEach((u) => u?.());
}
