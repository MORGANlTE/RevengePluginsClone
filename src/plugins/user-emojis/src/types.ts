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

export interface PluginCache {
    selectedAppId: string;
    apps: DiscoveredApp[];
    emojis: AppEmoji[];
    updatedAt: number;
}
