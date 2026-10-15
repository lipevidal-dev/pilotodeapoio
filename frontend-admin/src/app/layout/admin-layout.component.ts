import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isEmployeesOnlyAdminRole } from '../models/auth.models';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const FULL_NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: 'pi pi-home', route: '/dashboard' },
      { label: 'Geração de Escala', icon: 'pi pi-calendar', route: '/escala' },
    ],
  },
  {
    title: 'Cadastros Operacionais',
    items: [
      { label: 'Férias', icon: 'pi pi-sun', route: '/cadastros/ferias' },
      { label: 'Folgas Pedidas', icon: 'pi pi-calendar-minus', route: '/cadastros/folgas-pedidas' },
      { label: 'Voos', icon: 'pi pi-send', route: '/cadastros/voos' },
      { label: 'Simulador', icon: 'pi pi-desktop', route: '/cadastros/simulador' },
      { label: 'Curso', icon: 'pi pi-book', route: '/cadastros/curso' },
      { label: 'CMA', icon: 'pi pi-heart', route: '/cadastros/cma' },
      { label: 'Outros', icon: 'pi pi-ellipsis-h', route: '/cadastros/outros' },
    ],
  },
  {
    title: 'Configurações',
    items: [
      { label: 'Funcionários', icon: 'pi pi-users', route: '/funcionarios' },
      { label: 'Cargos', icon: 'pi pi-briefcase', route: '/configuracoes/cargos' },
      { label: 'Turnos', icon: 'pi pi-clock', route: '/configuracoes/turnos' },
    ],
  },
];

const EMPLOYEES_ONLY_NAV_SECTIONS: NavSection[] = [
  {
    title: 'Configurações',
    items: [{ label: 'Funcionários', icon: 'pi pi-users', route: '/funcionarios' }],
  },
];

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent {
  private readonly auth = inject(AuthService);

  readonly systemName = 'Escala Piloto de Apoio v2';
  readonly userName = () => this.auth.user()?.name ?? 'Administrador';

  readonly visibleNavSections = computed(() => {
    const role = this.auth.user()?.role;
    if (role && isEmployeesOnlyAdminRole(role)) {
      return EMPLOYEES_ONLY_NAV_SECTIONS;
    }
    return FULL_NAV_SECTIONS;
  });

  get navSections(): NavSection[] {
    return this.visibleNavSections();
  }

  logout(): void {
    this.auth.logout();
  }
}
