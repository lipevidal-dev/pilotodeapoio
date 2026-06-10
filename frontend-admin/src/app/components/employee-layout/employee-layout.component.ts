import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-employee-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './employee-layout.component.html',
  styleUrl: './employee-layout.component.scss',
})
export class EmployeeLayoutComponent {
  private readonly auth = inject(AuthService);

  readonly userName = () => this.auth.user()?.name ?? 'Colaborador';

  readonly navItems: NavItem[] = [
    { label: 'Minha Escala', icon: 'pi pi-calendar', route: '/portal/escala' },
    { label: 'Solicitar Folga', icon: 'pi pi-calendar-minus', route: '/portal/folga' },
    { label: 'Meu Perfil', icon: 'pi pi-user', route: '/portal/perfil' },
    { label: 'Notificações', icon: 'pi pi-bell', route: '/portal/notificacoes' },
  ];

  logout(): void {
    this.auth.logout();
  }
}
