import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  BatchDeleteResult,
  CreateLabeledPreAllocationBatchPayload,
  PreAllocation,
  PreAllocationBatchResult,
  UpdateLabeledPreAllocationPayload,
} from '../models/api.models';

@Injectable()
export abstract class LabeledPreAllocationService {
  protected readonly http = inject(HttpClient);
  protected readonly base = environment.apiBaseUrl;

  protected abstract readonly resourcePath: string;

  list(params?: { year?: number; month?: number }): Observable<PreAllocation[]> {
    const q = new URLSearchParams();
    if (params?.year) q.set('year', String(params.year));
    if (params?.month) q.set('month', String(params.month));
    const qs = q.toString();
    return this.http.get<PreAllocation[]>(`${this.base}/${this.resourcePath}${qs ? `?${qs}` : ''}`);
  }

  createBatch(payload: CreateLabeledPreAllocationBatchPayload): Observable<PreAllocationBatchResult> {
    return this.http.post<PreAllocationBatchResult>(`${this.base}/${this.resourcePath}/batch`, payload);
  }

  update(id: string, payload: UpdateLabeledPreAllocationPayload): Observable<PreAllocation> {
    return this.http.put<PreAllocation>(`${this.base}/${this.resourcePath}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${this.resourcePath}/${id}`);
  }

  deleteBatch(ids: string[]): Observable<BatchDeleteResult> {
    return this.http.delete<BatchDeleteResult>(`${this.base}/${this.resourcePath}/batch`, {
      body: { ids },
    });
  }
}

@Injectable({ providedIn: 'root' })
export class SimulatorService extends LabeledPreAllocationService {
  protected readonly resourcePath = 'simulators';
}

@Injectable({ providedIn: 'root' })
export class CourseService extends LabeledPreAllocationService {
  protected readonly resourcePath = 'courses';
}

@Injectable({ providedIn: 'root' })
export class CmaService extends LabeledPreAllocationService {
  protected readonly resourcePath = 'cmas';
}

@Injectable({ providedIn: 'root' })
export class OtherOperationalAllocationService extends LabeledPreAllocationService {
  protected readonly resourcePath = 'other-operational-allocations';
}
