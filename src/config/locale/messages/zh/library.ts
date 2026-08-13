export default {
  // 资源库 — 任务历史
  title: '资源库',
  files: '文件',
  noFiles: '暂无文件',
  upload: '上传',
  download: '下载',
  delete: '删除',
  rename: '重命名',
  openFolder: '打开文件夹',

  // 搜索与列表
  searchPlaceholder: '搜索对话...',
  chatsCount: '{count} 个对话',
  chatsCountPlural: '{count} 个对话',
  select: '选择',
  cancel: '取消',
  done: '完成',
  loading: '加载中...',
  noChatsFound: '未找到对话',
  noChatsYet: '暂无对话',
  adjustSearch: '试试其他搜索词',
  startNewTask: '开始新任务',
  untitled: '无标题',
  lastMessage: '最后消息',

  // 排序
  sortBy: '排序',
  sortNewest: '最新优先',
  sortOldest: '最旧优先',
  sortNameAZ: '名称 A–Z',
  sortNameZA: '名称 Z–A',
  sortRecentlyUpdated: '最近更新',

  // 筛选
  filterAll: '全部',
  filterRunning: '运行中',
  filterCompleted: '已完成',
  filterError: '错误',
  filterFavorites: '收藏',

  // 状态标签
  statusRunning: '运行中',
  statusCompleted: '已完成',
  statusError: '错误',
  statusStopped: '已停止',

  // 批量操作
  selectAll: '全选',
  deselectAll: '取消全选',
  selectedCount: '已选 {count} 项',
  deleteSelected: '删除选中',
  deleteConfirmTitle: '删除对话',
  deleteConfirmMessage: '确定要删除 {count} 个对话吗？此操作不可撤销。',
  deleteConfirmButton: '删除',
  deleteAlsoFolder: '同时删除磁盘上的会话文件夹',
  deleting: '删除中...',

  // 相对时间
  justNow: '刚刚',
  minuteAgo: '{count} 分钟前',
  minutesAgo: '{count} 分钟前',
  hourAgo: '{count} 小时前',
  hoursAgo: '{count} 小时前',
  dayAgo: '1 天前',
  daysAgo: '{count} 天前',

  // Metadata columns
  workspace: '工作区',
  model: '模型',
  cost: '费用',
  durationLabel: '耗时',

  graphifyTab: '知识图谱',
  graphifyTitle: '知识图谱',
  graphifyLastRun: '上次运行',
  graphifyRebuild: '立即重建',
  graphifyRebuilding: '正在重建…',
  graphifyRebuildDone: '图谱已重建',
  graphifyError: '图谱重建失败',
  graphifyDisabled:
    '未安装 graphify。请在此工作区运行 `pip install graphify`。',
  graphifyDisabledHint:
    '此工作区未安装 graphify。请运行 `pip install graphify`（或对应的环境命令）然后重试重建。',
  graphifyEmpty: '尚未生成图谱。点击"重建"创建一个。',
  graphifyReport: '图谱报告',
  graphifyNoReport: '无可用报告。',
  graphifyStateIdle: '空闲',
  graphifyStatePending: '排队中',
  graphifyStateRunning: '正在重建…',
  graphifyStateError: '错误',
  graphifyStateDisabled: '未安装',
  graphifyWindowsUnsupported:
    'Windows 暂不支持内嵌图谱查看器 — 请手动打开 graphify-out/graph.html。',
};
