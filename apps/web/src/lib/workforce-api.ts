import { request } from './api.ts'
import type { EmployeeView, WorkforceCompany, WorkforceTaskInput, WorkforceTask, WorkforceDetail, WorkforceList, MeResponse } from '@marketing-agent/shared'
export const workforceApi = {
  companies: () => request<{companies:WorkforceCompany[]}>('/api/workforce/companies'),
  employees: () => request<{employees:EmployeeView[]}>('/api/workforce/employees'),
  createEmployee: (body:{name:string;email:string;password:string;companyIds:string[]}) => request<{employee:EmployeeView}>('/api/workforce/employees',{method:'POST',body}),
  updateEmployee: (id:string,body:{companyIds:string[];active:boolean;confirmRemoval:boolean}) => request<{employee:EmployeeView}>(`/api/workforce/employees/${id}`,{method:'PATCH',body}),
  tasks: (params:Record<string,string>) => request<WorkforceList>(`/api/workforce/tasks?${new URLSearchParams(params)}`),
  detail: (id:string) => request<WorkforceDetail>(`/api/workforce/tasks/${id}`),
  createTask: (task:WorkforceTaskInput,draft:boolean) => request<{task:WorkforceTask}>('/api/workforce/tasks',{method:'POST',body:{task,draft}}),
  updateTask: (id:string,version:number,task:WorkforceTaskInput) => request<{task:WorkforceTask}>(`/api/workforce/tasks/${id}`,{method:'PATCH',body:{task,version}}),
  action: (id:string,action:string,version:number,note='',decision?:string) => request<{task:WorkforceTask}>(`/api/workforce/tasks/${id}/${action}`,{method:'POST',body:{version,note,...(decision?{decision}:{})}}),
  report: (id:string,body:{version:number;kind:'progress'|'blocker'|'submit';content:string;links:string[]}) => request<WorkforceDetail>(`/api/workforce/tasks/${id}/reports`,{method:'POST',body}),
  changePassword: (currentPassword:string,newPassword:string) => request<MeResponse>('/api/auth/change-password',{method:'POST',body:{currentPassword,newPassword}}),
}
