import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.authRequired) {
    return next(req);
  }
  const auth = inject(AuthService);
  const token = auth.getToken();
  if (!token || req.url.includes('/auth/login')) {
    return next(req);
  }
  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    }),
  );
};
