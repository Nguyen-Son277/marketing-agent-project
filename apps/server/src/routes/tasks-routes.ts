/**
 * Điểm nạp cho module công việc.
 *
 * Vì sao có tệp này: `main.ts` dò tìm module theo `${name}-routes.ts` với
 * `name = tasks`, nên nó cần `tasks-routes.ts`, trong khi quy ước tên export là
 * `taskRoutes`. Tệp này giữ cả hai đầu khớp nhau mà không đổi tên tệp nghiệp vụ.
 */
export { taskRoutes } from './task-routes.ts'
