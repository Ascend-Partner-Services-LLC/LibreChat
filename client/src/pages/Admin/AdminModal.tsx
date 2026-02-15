import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle } from '@librechat/client';
import AdminPage from '~/pages/Admin/AdminPage';

export function AdminModal({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | HTMLDivElement | null>;
}) {
  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent
        title="Admin"
        className="w-11/12 bg-background text-text-primary shadow-2xl"
      >
        <OGDialogHeader>
          <OGDialogTitle>Admin</OGDialogTitle>
        </OGDialogHeader>
        <AdminPage isModal onClose={() => onOpenChange(false)} />
      </OGDialogContent>
    </OGDialog>
  );
}
