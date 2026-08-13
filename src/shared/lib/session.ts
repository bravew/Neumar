/**
 * Session management utilities
 *
 * Session ID format: 20260112112244_how-to-use-xxx
 * - Timestamp prefix for sorting (YYYYMMDDHHmmss)
 * - Slug suffix for human readability (auto-generated from prompt)
 */

import { API_BASE_URL } from '@/config';
import { APP_DATA_DIR } from '@/config/branding';
import { getSettings } from '@/shared/db/settings';

import { expandPath } from './paths';

/**
 * Generate a timestamp string in format YYYYMMDDHHmmss
 */
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Common words to exclude from slug generation
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'and',
  'but',
  'if',
  'or',
  'because',
  'until',
  'while',
  'about',
  'against',
  'i',
  'me',
  'my',
  'myself',
  'we',
  'our',
  'ours',
  'ourselves',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
  'he',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'it',
  'its',
  'itself',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'am',
  'please',
  'help',
  'want',
  'like',
  'make',
  'create',
  'build',
  'write',
  'generate',
]);

/**
 * Chinese to English common translations for prompt keywords
 */
const CHINESE_KEYWORDS: Record<string, string> = {
  创建: 'create',
  生成: 'generate',
  制作: 'make',
  写: 'write',
  帮我: 'help',
  做: 'do',
  网站: 'website',
  页面: 'page',
  应用: 'app',
  程序: 'program',
  代码: 'code',
  文档: 'doc',
  报告: 'report',
  演示: 'presentation',
  幻灯片: 'slides',
  图片: 'image',
  图表: 'chart',
  表格: 'table',
  数据: 'data',
  分析: 'analysis',
  设计: 'design',
  登录: 'login',
  注册: 'register',
  用户: 'user',
  管理: 'manage',
  系统: 'system',
  功能: 'feature',
  测试: 'test',
  部署: 'deploy',
  配置: 'config',
  接口: 'api',
  数据库: 'database',
  前端: 'frontend',
  后端: 'backend',
  服务: 'service',
  组件: 'component',
  样式: 'style',
  布局: 'layout',
  动画: 'animation',
  交互: 'interaction',
  响应式: 'responsive',
  移动端: 'mobile',
  桌面: 'desktop',
  优化: 'optimize',
  修复: 'fix',
  调试: 'debug',
  问题: 'issue',
  错误: 'error',
  游戏: 'game',
  工具: 'tool',
  脚本: 'script',
  自动化: 'automation',
  爬虫: 'crawler',
  机器人: 'bot',
  聊天: 'chat',
  邮件: 'email',
  通知: 'notification',
  搜索: 'search',
  排序: 'sort',
  过滤: 'filter',
  导入: 'import',
  导出: 'export',
  上传: 'upload',
  下载: 'download',
  保存: 'save',
  删除: 'delete',
  编辑: 'edit',
  更新: 'update',
  列表: 'list',
  详情: 'detail',
  首页: 'home',
  仪表盘: 'dashboard',
  统计: 'statistics',
  日历: 'calendar',
  时间: 'time',
  日期: 'date',
  地图: 'map',
  位置: 'location',
  天气: 'weather',
  新闻: 'news',
  博客: 'blog',
  文章: 'article',
  评论: 'comment',
  点赞: 'like',
  分享: 'share',
  收藏: 'favorite',
  订单: 'order',
  购物车: 'cart',
  支付: 'payment',
  商品: 'product',
  库存: 'inventory',
  物流: 'logistics',
  客户: 'customer',
  员工: 'employee',
  项目: 'project',
  任务: 'task',
  进度: 'progress',
  计划: 'plan',
  会议: 'meeting',
  日程: 'schedule',
  提醒: 'reminder',
  设置: 'settings',
  权限: 'permission',
  角色: 'role',
  认证: 'auth',
  安全: 'security',
  加密: 'encrypt',
  备份: 'backup',
  恢复: 'restore',
  日志: 'log',
  监控: 'monitor',
  报警: 'alert',
  性能: 'performance',
  缓存: 'cache',
  队列: 'queue',
  消息: 'message',
  推送: 'push',
  同步: 'sync',
  异步: 'async',
  并发: 'concurrent',
  线程: 'thread',
  进程: 'process',
  内存: 'memory',
  存储: 'storage',
  文件: 'file',
  目录: 'directory',
  路径: 'path',
  链接: 'link',
  视频: 'video',
  音频: 'audio',
  直播: 'live',
  录制: 'record',
  播放: 'play',
  暂停: 'pause',
  停止: 'stop',
  开始: 'start',
  结束: 'end',
  打开: 'open',
  关闭: 'close',
  显示: 'show',
  隐藏: 'hide',
  展开: 'expand',
  折叠: 'collapse',
  放大: 'zoom-in',
  缩小: 'zoom-out',
  旋转: 'rotate',
  翻转: 'flip',
  裁剪: 'crop',
  滤镜: 'filter',
  特效: 'effect',
  模板: 'template',
  主题: 'theme',
  皮肤: 'skin',
  字体: 'font',
  颜色: 'color',
  背景: 'background',
  边框: 'border',
  阴影: 'shadow',
  圆角: 'rounded',
  渐变: 'gradient',
  透明: 'transparent',
  模糊: 'blur',
  清晰: 'clear',
  亮度: 'brightness',
  对比度: 'contrast',
  饱和度: 'saturation',
  锐化: 'sharpen',
  降噪: 'denoise',
  压缩: 'compress',
  解压: 'decompress',
  转换: 'convert',
  合并: 'merge',
  拆分: 'split',
  复制: 'copy',
  粘贴: 'paste',
  剪切: 'cut',
  撤销: 'undo',
  重做: 'redo',
  全选: 'select-all',
  取消: 'cancel',
  确认: 'confirm',
  提交: 'submit',
  重置: 'reset',
  刷新: 'refresh',
  加载: 'load',
  预览: 'preview',
  发布: 'publish',
  草稿: 'draft',
  归档: 'archive',
  回收站: 'trash',
  永久删除: 'permanent-delete',
  还原: 'restore',
  版本: 'version',
  历史: 'history',
  对比: 'compare',
  差异: 'diff',
  冲突: 'conflict',
  解决: 'resolve',
  审核: 'review',
  批准: 'approve',
  拒绝: 'reject',
  待处理: 'pending',
  处理中: 'processing',
  已完成: 'completed',
  已取消: 'cancelled',
  失败: 'failed',
  成功: 'success',
  警告: 'warning',
  信息: 'info',
  提示: 'tip',
  帮助: 'help',
  关于: 'about',
  联系: 'contact',
  反馈: 'feedback',
  投诉: 'complaint',
  建议: 'suggestion',
  问卷: 'survey',
  投票: 'vote',
  排名: 'ranking',
  积分: 'points',
  等级: 'level',
  徽章: 'badge',
  成就: 'achievement',
  奖励: 'reward',
  优惠券: 'coupon',
  折扣: 'discount',
  促销: 'promotion',
  活动: 'event',
  抽奖: 'lottery',
  红包: 'red-packet',
  转账: 'transfer',
  充值: 'recharge',
  提现: 'withdraw',
  余额: 'balance',
  账单: 'bill',
  发票: 'invoice',
  收据: 'receipt',
  合同: 'contract',
  协议: 'agreement',
  条款: 'terms',
  隐私: 'privacy',
  声明: 'statement',
  公告: 'announcement',
};

/**
 * Convert a prompt string to an English slug
 * - Extracts meaningful keywords
 * - Removes stop words
 * - Converts to lowercase
 * - Joins with hyphens
 * - Limits length
 */
export function promptToSlug(prompt: string, maxLength: number = 50): string {
  let text = prompt;

  // Replace Chinese characters with English equivalents
  for (const [chinese, english] of Object.entries(CHINESE_KEYWORDS)) {
    text = text.replace(new RegExp(chinese, 'g'), ` ${english} `);
  }

  // Remove non-alphanumeric characters except spaces and hyphens
  text = text.replace(/[^a-zA-Z0-9\s-]/g, ' ');

  // Split into words
  const words = text
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word.length > 0);

  // Remove stop words and keep meaningful words
  const meaningfulWords = words.filter(
    (word) => !STOP_WORDS.has(word) && word.length > 1,
  );

  // If no meaningful words, use first few words from original
  const finalWords =
    meaningfulWords.length > 0
      ? meaningfulWords.slice(0, 6)
      : words.slice(0, 4);

  // Join with hyphens and limit length
  let slug = finalWords.join('-');

  // Truncate if too long
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    // Remove trailing hyphen if cut in middle of word
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > maxLength * 0.6) {
      slug = slug.substring(0, lastHyphen);
    }
  }

  // Fallback if empty
  if (!slug) {
    slug = 'task';
  }

  return slug;
}

/**
 * Generate a new session ID
 * Format: YYYYMMDDHHmmss_slug-from-prompt
 */
export function generateSessionId(prompt: string): string {
  const timestamp = generateTimestamp();
  const slug = promptToSlug(prompt);
  return `${timestamp}_${slug}`;
}

/**
 * Generate a task folder name within a session
 * Format: task-01, task-02, etc.
 */
export function generateTaskFolderName(taskIndex: number): string {
  return `task-${String(taskIndex).padStart(2, '0')}`;
}

/**
 * Parse session ID to extract timestamp and slug
 */
export function parseSessionId(sessionId: string): {
  timestamp: string;
  slug: string;
  date: Date;
} {
  const parts = sessionId.split('_');
  const timestamp = parts[0] || '';
  const slug = parts.slice(1).join('_');

  // Parse timestamp to Date
  let date = new Date();
  if (timestamp.length === 14) {
    const year = parseInt(timestamp.substring(0, 4), 10);
    const month = parseInt(timestamp.substring(4, 6), 10) - 1;
    const day = parseInt(timestamp.substring(6, 8), 10);
    const hours = parseInt(timestamp.substring(8, 10), 10);
    const minutes = parseInt(timestamp.substring(10, 12), 10);
    const seconds = parseInt(timestamp.substring(12, 14), 10);
    date = new Date(year, month, day, hours, minutes, seconds);
  }

  return { timestamp, slug, date };
}

/**
 * Get session display name from session ID
 */
export function getSessionDisplayName(sessionId: string): string {
  const { slug, date } = parseSessionId(sessionId);

  // Format date for display
  const dateStr = date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Convert slug to title case
  const title = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `${title} (${dateStr})`;
}

/**
 * Resolve the on-disk session folder for a task.
 *
 * Mirrors the backend convention in src-api/src/app/api/ag-ui.ts:785 —
 * `${workDir}/sessions/session-${taskId}`. Returns `null` when no workDir
 * can be resolved so callers can fail open rather than throw.
 */
export async function computeSessionFolder(
  taskId: string,
  taskWorkDir?: string | null,
): Promise<string | null> {
  const workDir = taskWorkDir || getSettings().workDir || `~/${APP_DATA_DIR}`;
  if (!workDir) return null;
  const expanded = await expandPath(workDir);
  return `${expanded}/sessions/session-${taskId}`;
}

/**
 * Delete a task's session folder via the backend API.
 *
 * Resolution priority for the base directory:
 *   1. Per-task `taskWorkDir` (passed by the caller from `task.work_dir`)
 *   2. Global `settings.workDir`
 *   3. Default app data directory (`~/<APP_DATA_DIR>`)
 *
 * Issues a DELETE request to `/files/delete-dir`. Failures are logged
 * but never re-thrown — folder cleanup is best-effort.
 */
export async function deleteSessionFolder(
  taskId: string,
  taskWorkDir?: string | null,
  sessionId?: string | null,
): Promise<void> {
  try {
    const settings = getSettings();
    // Per-task workDir takes priority over global settings
    const workDir = taskWorkDir || settings.workDir || `~/${APP_DATA_DIR}`;
    const expandedWorkDir = await expandPath(workDir);
    // Use the actual session_id when available (e.g. "20260222_weather-report"),
    // fall back to the legacy "session-{taskId}" format
    const folderName = sessionId || `session-${taskId}`;
    const sessionFolderPath = `${expandedWorkDir}/sessions/${folderName}`;

    const response = await fetch(`${API_BASE_URL}/files/delete-dir`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sessionFolderPath }),
    });

    if (!response.ok) {
      console.error('Failed to delete session folder:', await response.text());
    }
  } catch (error) {
    console.error('Error deleting session folder:', error);
  }
}
