export function getErrorMessage(error, fallback = '操作失败，请稍后重试') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}
