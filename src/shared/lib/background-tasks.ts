/**
 * Background Task Manager
 *
 * Manages tasks running in the background when user switches to another task.
 * Allows multiple tasks to run in parallel and tracks their status.
 * Enforces limits and periodic cleanup to prevent memory leaks.
 */

export interface BackgroundTask {
  taskId: string;
  sessionId: string; // Backend session ID
  abortController: AbortController;
  isRunning: boolean;
  startedAt: Date;
  prompt: string;
}

// Global map of background tasks with size limit
const backgroundTasks = new Map<string, BackgroundTask>();
const MAX_BACKGROUND_TASKS = 10;
const TASK_TIMEOUT = 60 * 60 * 1000; // 1 hour max runtime
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

// Listeners for background task status changes
type BackgroundTaskListener = (tasks: BackgroundTask[]) => void;
const listeners = new Set<BackgroundTaskListener>();

// Periodic cleanup for stale tasks (guard against HMR duplicate timers)
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    cleanupStaleTasks();
  }, CLEANUP_INTERVAL);
}

ensureCleanupTimer();

/**
 * Notify all listeners of task changes
 */
function notifyListeners() {
  const tasks = Array.from(backgroundTasks.values());
  listeners.forEach((listener) => listener(tasks));
}

/**
 * Cleanup stale tasks that have exceeded timeout
 */
function cleanupStaleTasks(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [taskId, task] of backgroundTasks.entries()) {
    const runtime = now - task.startedAt.getTime();
    if (runtime > TASK_TIMEOUT) {
      console.warn(
        `[BackgroundTasks] Force stopping stale task: ${taskId} (runtime: ${Math.round(runtime / 1000)}s)`,
      );
      task.abortController.abort('Task timeout exceeded');
      backgroundTasks.delete(taskId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.warn(
      `[BackgroundTasks] Cleanup: removed ${cleaned} stale tasks (remaining: ${backgroundTasks.size})`,
    );
    notifyListeners();
  }
}

/**
 * Evict oldest task to make room for new one
 */
function evictOldestTask(): void {
  let oldestId: string | null = null;
  let oldestTime = Infinity;

  for (const [taskId, task] of backgroundTasks.entries()) {
    if (task.startedAt.getTime() < oldestTime) {
      oldestTime = task.startedAt.getTime();
      oldestId = taskId;
    }
  }

  if (oldestId) {
    const task = backgroundTasks.get(oldestId);
    if (task) {
      console.warn(`[BackgroundTasks] Evicting oldest task: ${oldestId}`);
      task.abortController.abort('Task evicted - capacity limit reached');
      backgroundTasks.delete(oldestId);
    }
  }
}

/**
 * Add a task to background
 */
export function addBackgroundTask(
  task: Omit<BackgroundTask, 'startedAt'>,
): void {
  // Enforce max limit
  if (backgroundTasks.size >= MAX_BACKGROUND_TASKS) {
    console.warn(
      `[BackgroundTasks] At capacity (${MAX_BACKGROUND_TASKS}), evicting oldest task`,
    );
    evictOldestTask();
  }

  backgroundTasks.set(task.taskId, {
    ...task,
    startedAt: new Date(),
  });
  console.warn(
    `[BackgroundTasks] Added task: ${task.taskId} (total: ${backgroundTasks.size}/${MAX_BACKGROUND_TASKS})`,
  );
  notifyListeners();
}

/**
 * Remove a task from background
 */
export function removeBackgroundTask(taskId: string): void {
  backgroundTasks.delete(taskId);
  console.warn(
    `[BackgroundTasks] Removed task: ${taskId} (remaining: ${backgroundTasks.size})`,
  );
  notifyListeners();
}

/**
 * Get a background task by ID
 */
export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
  return backgroundTasks.get(taskId);
}

/**
 * Get all background tasks
 */
export function getAllBackgroundTasks(): BackgroundTask[] {
  return Array.from(backgroundTasks.values());
}

/**
 * Get count of running background tasks
 */
export function getRunningTaskCount(): number {
  return Array.from(backgroundTasks.values()).filter((t) => t.isRunning).length;
}

/**
 * Update task status
 */
export function updateBackgroundTaskStatus(
  taskId: string,
  isRunning: boolean,
): void {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.isRunning = isRunning;
    if (!isRunning) {
      // Task completed, remove from background after a short delay
      setTimeout(() => {
        removeBackgroundTask(taskId);
      }, 1000);
    }
    notifyListeners();
  }
}

/**
 * Check if a task is running in background
 */
export function isTaskRunningInBackground(taskId: string): boolean {
  const task = backgroundTasks.get(taskId);
  return task?.isRunning ?? false;
}

/**
 * Stop a background task
 */
export function stopBackgroundTask(taskId: string): void {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.abortController.abort();
    task.isRunning = false;
    removeBackgroundTask(taskId);
  }
}

/**
 * Subscribe to background task changes
 */
export function subscribeToBackgroundTasks(
  listener: BackgroundTaskListener,
): () => void {
  listeners.add(listener);
  // Immediately call with current state
  listener(getAllBackgroundTasks());
  // Return unsubscribe function
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Get metrics for monitoring
 */
export function getBackgroundTaskMetrics() {
  return {
    totalTasks: backgroundTasks.size,
    maxTasks: MAX_BACKGROUND_TASKS,
    runningTasks: getRunningTaskCount(),
    utilizationPercent: Math.round(
      (backgroundTasks.size / MAX_BACKGROUND_TASKS) * 100,
    ),
  };
}

/**
 * Clear all background tasks
 */
export function clearAllBackgroundTasks(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  backgroundTasks.forEach((task) => {
    task.abortController.abort();
  });
  backgroundTasks.clear();
  notifyListeners();
}
