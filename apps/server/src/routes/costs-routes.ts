/**
 * Điểm nạp cho module chi phí.
 *
 * Vì sao có tệp này: `main.ts` dò tìm `${name}-routes.ts` với `name = costs`, nên
 * nó cần `costs-routes.ts`, còn quy ước export là `costRoutes`. Tệp này nối hai
 * quy ước với nhau.
 */
export { costRoutes } from './cost-routes.ts'
