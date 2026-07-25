/**
 * Shared vocabulary — anything used on more than one surface.
 *
 * Terminology (PRD §5). Pick one word per concept and never drift:
 *   读        把链接变成文字 (never 分析 / 转写 / ingest as a user-facing verb)
 *   阅读页     一集的产出页 (never 可视化)
 *   合集       一组集数 (never 语料 / corpus)
 *   图谱       知识图谱 (never 思维地图 / idea map)
 *   书架       用户自己的全部集数 (never 控制台 / dashboard)
 */
export const common = {
  zh: {
    'common.retry': '重试',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.saving': '保存中…',
    'common.clear': '清除',
    'common.loading': '加载中…',
    'common.loadMore': '加载更多',
    'common.close': '关闭',
    'common.back': '返回',
    'common.networkError': '网络错误，请重试',
    'common.copyLink': '复制链接',
    'common.copied': '链接已复制',
    'common.copyFailed': '复制失败，请手动复制地址栏链接',
    'common.export': '导出',
    'common.selectAll': '全选',
    'common.deselectAll': '取消全选',
    'common.skipToContent': '跳到主要内容',
    'common.retrying': '重试中…',
    'common.untitled': '未命名',
    'meta.title': 'NanoSparks — 读播客',
    'meta.description': '贴一条播客链接，10分钟内变成可读、可信、可再创作的图文',

    'empty.default.title': '还没有内容',
    'empty.default.desc': '贴一条播客链接就能开始。',

    'error.title': '这一页出错了',
    'error.desc': '我们已记录这个问题。你可以重试，或者回到首页贴一条新链接。',
    'error.digest': '错误编号 {digest}',
    'error.backHome': '回首页',
    'error.pageFailed': '没能加载这一页',

    'notFound.title': '找不到这一页',
    'notFound.desc': '链接可能已失效，或者这集还没有被读过。',

    'status.queued': '排队中',
    'status.downloading': '下载中',
    'status.transcribing': '转写中',
    'status.diarizing': '整理说话人',
    'status.analyzing': '生成导读',
    'status.ready': '可读',
    'status.failed': '失败',
    'status.processing': '处理中',
  },
  en: {
    'common.retry': 'Retry',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.clear': 'Clear',
    'common.loading': 'Loading…',
    'common.loadMore': 'Load more',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.networkError': 'Network error — please try again',
    'common.copyLink': 'Copy link',
    'common.copied': 'Link copied',
    'common.copyFailed': 'Copy failed — copy the address bar manually',
    'common.export': 'Export',
    'common.selectAll': 'Select all',
    'common.deselectAll': 'Deselect all',
    'common.skipToContent': 'Skip to main content',
    'common.retrying': 'Retrying…',
    'common.untitled': 'Untitled',
    'meta.title': 'NanoSparks — read your podcasts',
    'meta.description': 'Paste a podcast link. Ten minutes later it is readable, sourced, and ready to reuse.',

    'empty.default.title': 'Nothing here yet',
    'empty.default.desc': 'Paste a podcast link to get started.',

    'error.title': 'This page hit an error',
    'error.desc': 'We logged it. Try again, or head home and paste a new link.',
    'error.digest': 'Error {digest}',
    'error.backHome': 'Go home',
    'error.pageFailed': 'Could not load this page',

    'notFound.title': 'Page not found',
    'notFound.desc': 'The link may have expired, or this episode has not been read yet.',

    'status.queued': 'Queued',
    'status.downloading': 'Downloading',
    'status.transcribing': 'Transcribing',
    'status.diarizing': 'Separating speakers',
    'status.analyzing': 'Summarising',
    'status.ready': 'Ready',
    'status.failed': 'Failed',
    'status.processing': 'Processing',
  },
} as const;
