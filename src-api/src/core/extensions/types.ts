export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  contributes: {
    skills?: SkillContribution[];
    commands?: CommandContribution[];
    settingsTabs?: SettingsTabContribution[];
  };
}

export interface SkillContribution {
  id: string;
  name: string;
  description: string;
  entryPoint: string;
}

export interface CommandContribution {
  id: string;
  name: string;
  description: string;
  entryPoint: string;
}

export interface SettingsTabContribution {
  id: string;
  label: string;
  entryPoint: string;
}

export interface LoadedExtension {
  manifest: ExtensionManifest;
  basePath: string;
}
