import { Routes } from '@angular/router';
import { AdminLayoutComponent } from './layout/admin-layout.component';
import { EmployeeLayoutComponent } from './components/employee-layout/employee-layout.component';
import { adminGuard, employeeGuard, guestGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'portal',
    component: EmployeeLayoutComponent,
    canActivate: [employeeGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'escala' },
      {
        path: 'escala',
        loadComponent: () =>
          import('./pages/portal/portal-schedule.component').then((m) => m.PortalScheduleComponent),
      },
      {
        path: 'folga',
        loadComponent: () =>
          import('./pages/portal/portal-placeholder.component').then((m) => m.PortalPlaceholderComponent),
        data: {
          title: 'Solicitar Folga',
          subtitle: 'Solicitação de folga pelo portal do colaborador',
          message: 'Em breve você poderá solicitar folgas por aqui.',
        },
      },
      {
        path: 'perfil',
        loadComponent: () =>
          import('./pages/portal/portal-placeholder.component').then((m) => m.PortalPlaceholderComponent),
        data: {
          title: 'Meu Perfil',
          subtitle: 'Dados pessoais e preferências',
          message: 'Em breve você poderá consultar e atualizar seu perfil.',
        },
      },
      {
        path: 'notificacoes',
        loadComponent: () =>
          import('./pages/portal/portal-placeholder.component').then((m) => m.PortalPlaceholderComponent),
        data: {
          title: 'Notificações',
          subtitle: 'Avisos e comunicados da operação',
          message: 'Em breve você receberá notificações nesta área.',
        },
      },
    ],
  },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [adminGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'funcionarios',
        loadComponent: () =>
          import('./pages/employees/employees.component').then((m) => m.EmployeesComponent),
      },
      {
        path: 'escala',
        loadComponent: () =>
          import('./pages/schedule/schedule.component').then((m) => m.ScheduleComponent),
      },
      {
        path: 'cadastros/ferias',
        loadComponent: () =>
          import('./pages/cadastros/vacations/vacations.component').then((m) => m.VacationsComponent),
      },
      {
        path: 'cadastros/folgas-pedidas',
        loadComponent: () =>
          import('./pages/cadastros/requested-day-offs/requested-day-offs.component').then(
            (m) => m.RequestedDayOffsComponent,
          ),
      },
      {
        path: 'cadastros/voos',
        loadComponent: () =>
          import('./pages/cadastros/flights/flights.component').then((m) => m.FlightsComponent),
      },
      {
        path: 'cadastros/simulador',
        loadComponent: () =>
          import('./pages/cadastros/labeled-pre-allocation/labeled-pre-allocation.component').then(
            (m) => m.LabeledPreAllocationComponent,
          ),
        data: {
          title: 'Simulador',
          subtitle: 'Dias de simulador bloqueiam alocação — label fixo SIMULADOR',
          label: 'SIMULADOR',
          icon: 'pi pi-desktop',
          resource: 'simulators',
          tagSeverity: 'secondary',
          entityLabel: 'simulador',
        },
      },
      {
        path: 'cadastros/curso',
        loadComponent: () =>
          import('./pages/cadastros/labeled-pre-allocation/labeled-pre-allocation.component').then(
            (m) => m.LabeledPreAllocationComponent,
          ),
        data: {
          title: 'Curso',
          subtitle: 'Dias de curso bloqueiam alocação — label fixo CURSO',
          label: 'CURSO',
          icon: 'pi pi-book',
          resource: 'courses',
          tagSeverity: 'warn',
          entityLabel: 'curso',
        },
      },
      {
        path: 'cadastros/cma',
        loadComponent: () =>
          import('./pages/cadastros/labeled-pre-allocation/labeled-pre-allocation.component').then(
            (m) => m.LabeledPreAllocationComponent,
          ),
        data: {
          title: 'CMA',
          subtitle: 'Dias de CMA bloqueiam alocação — label fixo CMA',
          label: 'CMA',
          icon: 'pi pi-heart',
          resource: 'cmas',
          tagSeverity: 'success',
          entityLabel: 'CMA',
        },
      },
      {
        path: 'cadastros/outros',
        loadComponent: () =>
          import('./pages/cadastros/labeled-pre-allocation/labeled-pre-allocation.component').then(
            (m) => m.LabeledPreAllocationComponent,
          ),
        data: {
          title: 'Outros',
          subtitle: 'Outras alocações operacionais — label fixo OUTRO',
          label: 'OUTRO',
          icon: 'pi pi-ellipsis-h',
          resource: 'other-operational-allocations',
          tagSeverity: 'secondary',
          entityLabel: 'outro',
        },
      },
      {
        path: 'configuracoes/cargos',
        loadComponent: () =>
          import('./pages/configuracoes/roles/roles.component').then((m) => m.RolesComponent),
      },
      {
        path: 'configuracoes/turnos',
        loadComponent: () =>
          import('./pages/configuracoes/shifts/shifts.component').then((m) => m.ShiftsComponent),
      },
      {
        path: 'configuracoes/motor-escala',
        loadComponent: () =>
          import('./pages/configuracoes/motor-escala/motor-escala-config.component').then(
            (m) => m.MotorEscalaConfigComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
