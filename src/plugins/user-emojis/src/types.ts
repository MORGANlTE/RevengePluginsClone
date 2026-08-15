export type CommandName = "e" | "ed" | "esync" | "deleteemoji" | "stealemoji";

export interface CommandMeta {
    id: string;
    version: string;
    name: CommandName;
}

export interface DiscoveredApp {
    appId: string;
    appName: string;
    commands: Partial<Record<CommandName, CommandMeta>>;
}

export interface AppEmoji {
    id: string;
    name: string;
    animated: boolean;
}

export interface PluginStorage {
    selectedAppId: string;
    botPingToUserPing: boolean;
    emojis: AppEmoji[];
    apps: DiscoveredApp[];
}
