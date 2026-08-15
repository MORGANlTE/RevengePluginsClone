import { findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { dispatchAppCommand, emojiRegex, getActiveApp } from "../utils/botApi";
import { logStatus } from "../utils/logger";
import { closeEmojiModal } from "../utils/navigation";

export function patchMessageActions(): () => void {
    const unpatches: (() => void)[] = [];

    // Modern Discord Mobile: useMessageActions hook
    const messageActionsHook = findByProps("useMessageActions");
    if (messageActionsHook?.default) {
        unpatches.push(
            after("default", messageActionsHook, ([{ message }], res) => {
                if (!res || !Array.isArray(res)) return;
                const content = message?.content || "";
                const matches = Array.from(content.matchAll(emojiRegex));
                const app = getActiveApp();

                if (!app || matches.length === 0) return;

                matches.forEach((m) => {
                    const raw = m[0];
                    const name = m[1];
                    res.push({
                        label: `Steal :${name}:`,
                        icon: getAssetIDByName("ic_download_24px") ?? getAssetIDByName("ic_message_actions"),
                        action: () => {
                            dispatchAppCommand("stealemoji", message.channel_id, [
                                { type: 3, name: "emoji", value: raw },
                                { type: 3, name: "new_name", value: name },
                            ]);
                        },
                    });
                });
            })
        );
        logStatus("Patched modern useMessageActions hook");
    } else {
        logStatus("useMessageActions hook not found, using LazyActionSheet fallback");
    }

    // ActionSheet Fallback
    const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
    if (LazyActionSheet?.openLazy) {
        unpatches.push(
            before("openLazy", LazyActionSheet, (args) => {
                const [factory, key] = args;
                if (key === "MessageLongPressActionSheet" || key === "MessageActionsActionSheet") {
                    args[0] = async () => {
                        const raw = await factory();
                        const Component = raw?.default || raw;
                        if (typeof Component !== "function") return raw;

                        const PatchedSheet = (props: any) => {
                            const tree = Component(props);
                            if (!tree) return tree;

                            try {
                                const message = props?.message;
                                const content = message?.content || "";
                                const app = getActiveApp();

                                if (app && content) {
                                    const matches = Array.from(content.matchAll(emojiRegex));
                                    if (matches.length > 0) {
                                        const stealButtons = matches.map((m) => {
                                            const rawTag = m[0];
                                            const name = m[1];
                                            return (
                                                <RN.TouchableOpacity
                                                    key={`steal-${name}-${m[2]}`}
                                                    onPress={() => {
                                                        closeEmojiModal();
                                                        dispatchAppCommand("stealemoji", message.channel_id, [
                                                            { type: 3, name: "emoji", value: rawTag },
                                                            { type: 3, name: "new_name", value: name },
                                                        ]);
                                                    }}
                                                    style={{
                                                        padding: 14,
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                                                        borderRadius: 10,
                                                        marginHorizontal: 12,
                                                        marginVertical: 4,
                                                    }}
                                                >
                                                    <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>
                                                        Steal :{name}:
                                                    </RN.Text>
                                                    <RN.Text style={{ fontSize: 16 }}>📥</RN.Text>
                                                </RN.TouchableOpacity>
                                            );
                                        });

                                        const children = Array.isArray(tree.props?.children)
                                            ? [...tree.props.children, ...stealButtons]
                                            : [tree.props?.children, ...stealButtons];

                                        return React.cloneElement(tree, { ...tree.props }, children);
                                    }
                                }
                            } catch (e) {
                                logStatus(`Long-press render error: ${String(e)}`, true);
                            }
                            return tree;
                        };

                        return raw?.default ? { ...raw, default: PatchedSheet } : PatchedSheet;
                    };
                }
                return args;
            })
        );
        logStatus("Patched LazyActionSheet long-press interceptor");
    }

    return () => unpatches.forEach((u) => u?.());
}
