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
        path: 'preferencias-turno',
        loadComponent: () =>
          import('./pages/portal/portal-shift-preferences.component').then(
            (m) => m.PortalShiftPreferencesComponent,
          ),
      },
      {
        path: 'troca-turno',
        loadComponent: () =>
          import('./pages/portal/portal-shift-swaps.component').then(
            (m) => m.PortalShiftSwapsComponent,
          ),
      },
      {
        path: 'ferias',
        loadComponent: () =>
          import('./pages/portal/portal-vacation-request.component').then(
            (m) => m.PortalVacationRequestComponent,
          ),
      },
      { path: 'folga', pathMatch: 'full', redirectTo: 'escala' },
      { path: 'perfil', pathMatch: 'full', redirectTo: 'escala' },
      { path: 'notificacoes', pathMatch: 'full', redirectTo: 'escala' },
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
        path: 'cadastros/troca-turno',
        loadComponent: () =>
          import('./pages/cadastros/shift-swaps/shift-swaps-admin.component').then(
            (m) => m.ShiftSwapsAdminComponent,
          ),
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
      {
        path: 'configuracoes/perfil',
        loadComponent: () =>
          import('./pages/configuracoes/admin-profile/admin-profile.component').then(
            (m) => m.AdminProfileComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
