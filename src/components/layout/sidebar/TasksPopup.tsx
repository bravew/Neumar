import { useState } from 'react';

import { Library, ListTodo } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';

import { TaskItem } from './TaskItem';

interface TasksPopupProps {
  tasks: Task[];
  currentTaskId?: string;
  loadingTaskId: string | null;
  runningTaskIds: string[];
  t: ReturnType<typeof useLanguage>['t'];
  onSelectTask: (taskId: string) => void;
  onDeleteClick: (taskId: string, e: React.MouseEvent) => void;
  onToggleFavorite: (task: Task, e: React.MouseEvent) => void;
  onViewFolder: (taskId: string, e: React.MouseEvent) => void;
  onRename: (taskId: string, newTitle: string) => Promise<void>;
  onRegenerate: (taskId: string) => Promise<void>;
  onNavigateLibrary: () => void;
}

export function TasksPopup({
  tasks,
  currentTaskId,
  loadingTaskId,
  runningTaskIds,
  t,
  onSelectTask,
  onDeleteClick,
  onToggleFavorite,
  onViewFolder,
  onRename,
  onRegenerate,
  onNavigateLibrary,
}: TasksPopupProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [popupDropdownOpen, setPopupDropdownOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowPopup(true)}
      onMouseLeave={() => {
        if (!popupDropdownOpen) setShowPopup(false);
      }}
    >
      <button
        className={cn(
          'flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200',
          currentTaskId
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        )}
      >
        <ListTodo className="size-5" />
      </button>

      <AnimatePresence>
        {showPopup && (
          <>
            {/* Invisible bridge to prevent losing hover when moving to popup */}
            <div className="absolute top-0 left-full z-50 h-full w-3" />
            <motion.div
              className="bg-background border-border/60 absolute top-0 left-full z-50 ml-2 max-h-[70vh] w-80 overflow-hidden rounded-xl border shadow-xl"
              initial={{ opacity: 0, x: -8, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, scale: 0.97 }}
              transition={{
                duration: DURATION.normal,
                ease: EASE.out,
              }}
            >
              <div className="border-border/50 bg-muted/30 border-b px-4 py-3">
                <h3 className="text-foreground text-sm font-medium">
                  {t.nav.allTasks}
                </h3>
              </div>

              <div className="max-h-[calc(70vh-48px)] overflow-y-auto p-2">
                {tasks.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-muted-foreground text-sm">
                      {t.nav.noTasksYet}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {tasks.slice(0, 10).map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        isActive={currentTaskId === task.id}
                        isLoading={loadingTaskId === task.id}
                        isRunning={runningTaskIds.includes(task.id)}
                        variant="popup"
                        t={t}
                        onSelect={onSelectTask}
                        onDelete={onDeleteClick}
                        onToggleFavorite={onToggleFavorite}
                        onViewFolder={onViewFolder}
                        onRename={onRename}
                        onRegenerate={onRegenerate}
                        onDropdownOpenChange={(open) => {
                          setPopupDropdownOpen(open);
                          if (!open) setShowPopup(false);
                        }}
                      />
                    ))}
                    {tasks.length > 0 && (
                      <button
                        onClick={onNavigateLibrary}
                        className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                      >
                        <Library className="size-4" />
                        <span className="text-sm">{t.nav.allTasks}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
