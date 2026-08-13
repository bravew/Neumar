interface SidebarHoverHotzoneProps {
  onPreview: () => void;
}

export function SidebarHoverHotzone({ onPreview }: SidebarHoverHotzoneProps) {
  return (
    <button
      type="button"
      aria-label="Preview sidebar"
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className="fixed top-0 left-0 z-20 h-screen w-2 cursor-default bg-transparent"
    />
  );
}
