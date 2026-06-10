import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LOGIN_TRANSITION_TOTAL_MS, LoginTransitionComponent } from './login-transition.component';

describe('LoginTransitionComponent', () => {
  let fixture: ComponentFixture<LoginTransitionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginTransitionComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginTransitionComponent);
  });

  it('renderiza identidade GOL + ESCALA PAO', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.transition-gol-logo')).toBeTruthy();
    expect(el.querySelector('.transition-escala-title__pao')?.textContent).toContain('PAO');
    expect(el.querySelector('.transition-escala-subtitle')?.textContent).toContain('PLANEJAMENTO');
    expect(el.querySelector('.transition-loading-message')?.textContent).toContain('Preparando');
    expect(el.querySelector('.transition-dots')).toBeTruthy();
  });

  it('emite completed após animação corporativa', fakeAsync(() => {
    let emitted = false;
    fixture.componentInstance.completed.subscribe(() => {
      emitted = true;
    });
    fixture.detectChanges();
    tick(LOGIN_TRANSITION_TOTAL_MS);
    expect(emitted).toBeTrue();
  }));
});
