import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from '../../core/brand';
import { FlightPlanningService } from '../../services/flight-planning.service';

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
export class EmployeeLayoutComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly flightPlanning = inject(FlightPlanningService);

  readonly authRequired = environment.authRequired;
  readonly userName = () => this.auth.user()?.name ?? 'Colaborador';
  readonly brandLogoSrc = BRAND_LOGO_SRC;
  readonly brandLogoAlt = BRAND_LOGO_ALT;
  readonly isMobile = signal(false);
  readonly flightPlanningEnabled = signal(false);

  readonly navItems: NavItem[] = [
    { label: 'Minha Escala', icon: 'pi pi-calendar', route: '/portal/escala' },
    { label: 'Solicitar Folga', icon: 'pi pi-calendar-minus', route: '/portal/folga' },
    { label: 'Meu Perfil', icon: 'pi pi-user', route: '/portal/perfil' },
    { label: 'Notificações', icon: 'pi pi-bell', route: '/portal/notificacoes' },
  ];

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      const query = window.matchMedia('(max-width: 900px)');
      this.isMobile.set(query.matches);
      query.addEventListener('change', (event) => this.isMobile.set(event.matches));
    }
    this.flightPlanning.status().subscribe({
      next: (status) => this.flightPlanningEnabled.set(status.enabled),
      error: () => this.flightPlanningEnabled.set(false),
    });
  }

  logout(): void {
    this.auth.logout();
  }
}
