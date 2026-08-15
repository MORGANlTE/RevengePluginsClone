import { findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { dispatchAppCommand, emojiRegex, getActiveApp } from "../utils/botApi";
import { logStatus } from "../utils/logger";
import { closeEmojiModal } from "../utils/navigation";

export function patchMessageActions(): () => void {
    const unpatches: (() => void)[] = [];

    // 1. Modern Discord Mobile: useMessageActions hook
    const messageActionsHook = findByProps("useMessageActions");
    if (messageActionsHook) {
        const fn = messageActionsHook.default ? "default" : "useMessageActions";
        if (typeof messageActionsHook[fn] === "function") {
            unpatches.push(
                after(fn, messageActionsHook, ([{ message }], res) => {
                    if (!res || !Array.isArray(res) || !message?.content) return;
                    const matches = Array.from(String(message.content).matchAll(emojiRegex));
                    const app = getActiveApp();

                    if (!app || matches.length === 0) return;

                    matches.forEach((m) => {
                        const raw = m[0];
                        const name = m[1];
                        if (!res.some((item: any) => item?.label === `Steal :${name}:`)) {
                            res.push({
                                label: `Steal :${name}:`,
                                icon:
                                    getAssetIDByName("ic_download_24px") ??
                                    getAssetIDByName("DownloadIcon") ??
                                    getAssetIDByName("ic_message_actions"),
                                action: () => {
                                    dispatchAppCommand("stealemoji", message.channel_id, [
                                        { type: 3, name: "emoji", value: raw },
                                        { type: 3, name: "new_name", value: name },
                                    ]);
                                },
                            });
                        }
                    });
                })
            );
            logStatus("Patched modern useMessageActions hook");
        }
    }

    // 2. ActionSheet Interceptor for Discord Mobile Message Long Press
    const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
    if (LazyActionSheet?.openLazy) {
        unpatches.push(
            before("openLazy", LazyActionSheet, ([component, key, msg]) => {
                const message = msg?.message;
                if (
                    (key !== "MessageLongPressActionSheet" && key !== "MessageActionsActionSheet") ||
                    !message?.content
                ) {
                    return;
                }

                const matches = Array.from(String(message.content).matchAll(emojiRegex));
                const app = getActiveApp();
                if (!app || matches.length === 0) return;

                if (component && typeof component.then === "function") {
                    component.then((i: any) => {
                        const target = i?.default ? i : { default: i };
                        if (typeof target.default !== "function") return;

                        const unp = after("default", target, (_, comp) => {
                            React.useEffect(() => {
                                return () => {
                                    unp();
                                };
                            }, []);

                            const stealButtons = matches.map((m, idx) => {
                                const rawTag = m[0];
                                const name = m[1];
                                return (
                                    <RN.TouchableOpacity
                                        key={`user-emoji-steal-${name}-${idx}`}
                                        onPress={() => {
                                            closeEmojiModal();
                                            dispatchAppCommand("stealemoji", message.channel_id, [
                                                { type: 3, name: "emoji", value: rawTag },
                                                { type: 3, name: "new_name", value: name },
                                            ]);
                                        }}
                                        activeOpacity={0.7}
                                        style={{
                                            paddingVertical: 12,
                                            paddingHorizontal: 16,
                                            flexDirection: "row",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                                            borderRadius: 10,
                                            marginHorizontal: 12,
                                            marginVertical: 4,
                                        }}
                                    >
                                        <RN.Text
                                            style={{
                                                color: "#ffffff",
                                                fontSize: 14,
                                                fontWeight: "600",
                                            }}
                                        >
                                            Steal :{name}:
                                        </RN.Text>
                                        <RN.Text style={{ fontSize: 16 }}>📥</RN.Text>
                                    </RN.TouchableOpacity>
                                );
                            });

                            const buttons =
                                findInReactTree(
                                    comp,
                                    (x) => Array.isArray(x) && x.length > 0 && x[0]?.key !== undefined
                                ) ||
                                findInReactTree(
                                    comp,
                                    (x) =>
                                        Array.isArray(x) &&
                                        x.length > 0 &&
                                        (x[0]?.type?.name === "ButtonRow" ||
                                            x[0]?.type?.name === "ActionSheetRow" ||
                                            x[0]?.props?.label)
                                );

                            if (Array.isArray(buttons)) {
                                buttons.push(...stealButtons);
                            } else if (comp?.props?.children) {
                                if (Array.isArray(comp.props.children)) {
                                    comp.props.children.push(...stealButtons);
                                } else {
                                    comp.props.children = [comp.props.children, ...stealButtons];
                                }
                            }

                            return comp;
                        });
                    });
                }
            })
        );
        logStatus("Patched LazyActionSheet message long-press interceptor safely");
    }

    return () => unpatches.forEach((u) => u?.());
}
