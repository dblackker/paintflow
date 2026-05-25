import { createContext, ReactNode, useContext, useMemo, useState } from 'react';

interface TabItem {
  id: string;
  value?: string;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
}

interface TabsContextValue {
  activeValue: string;
  setActiveValue: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs compound components must be rendered inside <Tabs>.');
  }
  return context;
}

interface TabsProps {
  tabs?: TabItem[];
  items?: TabItem[];
  defaultTab?: string;
  defaultActive?: string;
  defaultValue?: string;
  onChange?: (tabId: string) => void;
  className?: string;
  children?: ReactNode;
}

export function Tabs({
  tabs,
  items,
  defaultTab,
  defaultActive,
  defaultValue,
  onChange,
  className = '',
  children,
}: TabsProps) {
  const normalizedTabs = tabs || items || [];
  const initialValue = defaultValue || defaultActive || defaultTab || normalizedTabs[0]?.value || normalizedTabs[0]?.id || '';
  const [activeValue, setActiveValueState] = useState(initialValue);
  const context = useMemo<TabsContextValue>(() => ({
    activeValue,
    setActiveValue(value) {
      setActiveValueState(value);
      onChange?.(value);
    },
  }), [activeValue, onChange]);

  if (children) {
    return (
      <TabsContext.Provider value={context}>
        <div className={className}>{children}</div>
      </TabsContext.Provider>
    );
  }

  const activeTab = normalizedTabs.find((tab) => (tab.value || tab.id) === activeValue);

  return (
    <TabsContext.Provider value={context}>
      <div className={className}>
        <TabsList>
          {normalizedTabs.map((tab) => (
            <TabsTrigger key={tab.value || tab.id} value={tab.value || tab.id} disabled={tab.disabled}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="mt-6">
          {activeTab?.content || children}
        </div>
      </div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className = '' }: TabsListProps) {
  return (
    <div className={`border-b border-gray-200 ${className}`}>
      <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
        {children}
      </nav>
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}

export function TabsTrigger({ value, disabled, children }: TabsTriggerProps) {
  const { activeValue, setActiveValue } = useTabsContext();
  const isActive = activeValue === value;

  return (
    <button
      type="button"
      onClick={() => !disabled && setActiveValue(value)}
      disabled={disabled}
      className={`whitespace-nowrap border-b-2 py-3 text-sm font-medium ${
        isActive
          ? 'border-blue-500 text-blue-600'
          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      aria-current={isActive ? 'page' : undefined}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className = '' }: TabsContentProps) {
  const { activeValue } = useTabsContext();
  if (activeValue !== value) return null;
  return <div className={`mt-6 ${className}`}>{children}</div>;
}

export const TabList = TabsList;
export const TabButton = TabsTrigger;
