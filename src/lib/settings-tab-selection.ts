export type SettingsTabNode = {
  value: string;
  children?: SettingsTabNode[];
};

export type SettingsTabSelection = {
  groupValue: string;
  leafValue: string;
};

export function getSettingsTabStructureKey(tabs: SettingsTabNode[]) {
  return tabs
    .map((tab) => `${tab.value}[${(tab.children ?? []).map((child) => child.value).join(",")}]`)
    .join("|");
}

export function resolveRequestedSettingsTab(
  tabs: SettingsTabNode[],
  requestedValue?: string | null
): SettingsTabSelection | null {
  if (!tabs.length) return null;

  if (requestedValue) {
    for (const tab of tabs) {
      if (tab.value === requestedValue) {
        return {
          groupValue: tab.value,
          leafValue: tab.children?.[0]?.value ?? tab.value,
        };
      }

      const child = tab.children?.find((item) => item.value === requestedValue);
      if (child) {
        return { groupValue: tab.value, leafValue: child.value };
      }
    }
  }

  const firstGroup = tabs[0];
  return {
    groupValue: firstGroup.value,
    leafValue: firstGroup.children?.[0]?.value ?? firstGroup.value,
  };
}

export function preserveSettingsTabSelection(
  tabs: SettingsTabNode[],
  currentGroupValue: string,
  currentLeafValue: string
): SettingsTabSelection | null {
  if (!tabs.length) return null;

  const group = tabs.find((tab) => tab.value === currentGroupValue) ?? tabs[0];
  const leaf = group.children?.find((tab) => tab.value === currentLeafValue)
    ?? group.children?.[0]
    ?? group;

  return { groupValue: group.value, leafValue: leaf.value };
}
