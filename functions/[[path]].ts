/**
 * Cloudflare Pages Functions · 全站入口
 *
 * 文件名的 [[path]] 是「可选的全路径捕获」，等价于匹配 / 以及任意多级路径，
 * 所以整个站点（含 /docx/12、/users/3/action 这类）都会进到这里，
 * 再由 src/app.ts 里的 handleRequest() 做统一路由 —— 与 Worker 版逻辑一致。
 *
 * 注意：Pages 会优先返回 public/ 里真实存在的静态文件，
 * 只有找不到静态文件时才调用本函数。所以不要把 index.html 放进 public/。
 */
import { handleRequest } from '../src/app';

export const onRequest = async (context: any): Promise<Response> => {
  return handleRequest(context.request, context.env);
};
