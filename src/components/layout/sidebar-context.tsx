import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

interface SidebarContextType {
  leftOpen: boolean;
  rightOpen: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

interface SidebarProviderProps {
  children: ReactNode;
  defaultLeftOpen?: boolean;
  defaultRightOpen?: boolean;
}

export function SidebarProvider({
  children,
  defaultLeftOpen = true,
  defaultRightOpen = true,
}: SidebarProviderProps) {
  const [leftOpen, setLeftOpen] = useState(defaultLeftOpen);
  const [rightOpen, setRightOpen] = useState(defaultRightOpen);

  const toggleLeft = useCallback(() => setLeftOpen((prev) => !prev), []);
  const toggleRight = useCallback(() => setRightOpen((prev) => !prev), []);

  return (
    <SidebarContext.Provider
      value={{
        leftOpen,
        rightOpen,
        toggleLeft,
        toggleRight,
        setLeftOpen,
        setRightOpen,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
