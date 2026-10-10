/**
 * Điểm nạp cho module tool.
 *
 * Vì sao có tệp này thay vì đổi tên `tool-routes.ts`: `main.ts` ghép tên module
 * theo quy tắc `${name}-routes.ts` với `name = tools`, nên nó tìm
 * `tools-routes.ts`. Giữ tệp này làm lớp nạp mỏng để tên tệp khớp cả quy ước
 * đặt tên của module (`toolRoutes`) lẫn quy tắc dò tìm của `main.ts`.
 */
export { toolRoutes } from './tool-routes.ts'
