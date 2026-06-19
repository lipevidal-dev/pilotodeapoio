import type { FastifyInstance } from "fastify";
import { healthController } from "../controllers/health.controller.js";
import {
  createEmployeeController,
  deleteEmployeeController,
  getEmployeeController,
  listEmployeesController,
  updateEmployeeController,
} from "../controllers/employee.controller.js";
import {
  createPreAllocationBatchController,
  createPreAllocationController,
  deletePreAllocationController,
  listPreAllocationsController,
} from "../controllers/pre-allocation.controller.js";
import {
  cmaHandlers,
  courseHandlers,
  otherOperationalHandlers,
  simulatorHandlers,
} from "../controllers/labeled-pre-allocation.controller.js";
import {
  createVacationBatchController,
  createVacationController,
  deleteVacationBatchController,
  deleteVacationController,
  listVacationsController,
  updateVacationController,
} from "../controllers/vacation.controller.js";
import {
  createRequestedDayOffBatchController,
  createRequestedDayOffController,
  deleteRequestedDayOffBatchController,
  deleteRequestedDayOffController,
  listRequestedDayOffsController,
  updateRequestedDayOffController,
} from "../controllers/requested-day-off.controller.js";
import {
  createFlightAssignmentBatchController,
  createFlightAssignmentController,
  deleteFlightAssignmentBatchController,
  deleteFlightAssignmentController,
  listFlightAssignmentsController,
  updateFlightAssignmentController,
} from "../controllers/flight-assignment.controller.js";
import {
  debugOperationalCadastrosController,
  listOperationalCadastrosController,
} from "../controllers/operational-cadastro.controller.js";
import {
  clearGeneratedScheduleController,
  generateApaoScheduleController,
  generateFlightsController,
  generateScheduleByStepsController,
  generateScheduleController,
  getPublishedScheduleController,
  getScheduleMonthController,
  publishScheduleController,
  validateScheduleController,
} from "../controllers/schedule.controller.js";
import {
  manualEditCellController,
  manualEditRangeController,
  manualEditMoveController,
} from "../controllers/manual-schedule-edit.controller.js";
import {
  createShiftController,
  deleteShiftController,
  getShiftController,
  listShiftsController,
  updateShiftController,
} from "../controllers/shift.controller.js";
import {
  createRoleController,
  deleteRoleController,
  getRoleController,
  listRolesController,
  updateRoleController,
} from "../controllers/role.controller.js";
import { loginController, meController } from "../controllers/auth.controller.js";
import {
  getNextMotorConfigController,
  updateNextMotorConfigController,
} from "../controllers/next-motor-config.controller.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", healthController);

  app.post("/auth/login", loginController);
  app.get("/auth/me", meController);

  app.get("/employees", listEmployeesController);
  app.get("/employees/:id", getEmployeeController);
  app.post("/employees", createEmployeeController);
  app.put("/employees/:id", updateEmployeeController);
  app.delete("/employees/:id", deleteEmployeeController);

  app.get("/shifts", listShiftsController);
  app.get("/shifts/:id", getShiftController);
  app.post("/shifts", createShiftController);
  app.put("/shifts/:id", updateShiftController);
  app.delete("/shifts/:id", deleteShiftController);

  app.get("/roles", listRolesController);
  app.get("/roles/:id", getRoleController);
  app.post("/roles", createRoleController);
  app.put("/roles/:id", updateRoleController);
  app.delete("/roles/:id", deleteRoleController);

  app.get("/vacations", listVacationsController);
  app.post("/vacations/batch", createVacationBatchController);
  app.post("/vacations", createVacationController);
  app.put("/vacations/:id", updateVacationController);
  app.delete("/vacations/batch", deleteVacationBatchController);
  app.delete("/vacations/:id", deleteVacationController);

  app.get("/requested-day-offs", listRequestedDayOffsController);
  app.post("/requested-day-offs/batch", createRequestedDayOffBatchController);
  app.post("/requested-day-offs", createRequestedDayOffController);
  app.put("/requested-day-offs/:id", updateRequestedDayOffController);
  app.delete("/requested-day-offs/batch", deleteRequestedDayOffBatchController);
  app.delete("/requested-day-offs/:id", deleteRequestedDayOffController);

  app.get("/flight-assignments", listFlightAssignmentsController);
  app.post("/flight-assignments/batch", createFlightAssignmentBatchController);
  app.post("/flight-assignments", createFlightAssignmentController);
  app.put("/flight-assignments/:id", updateFlightAssignmentController);
  app.delete("/flight-assignments/batch", deleteFlightAssignmentBatchController);
  app.delete("/flight-assignments/:id", deleteFlightAssignmentController);

  app.get("/preallocations", listPreAllocationsController);
  app.post("/preallocations/batch", createPreAllocationBatchController);
  app.post("/preallocations", createPreAllocationController);
  app.delete("/preallocations/:id", deletePreAllocationController);

  app.get("/simulators", simulatorHandlers.list);
  app.post("/simulators/batch", simulatorHandlers.createBatch);
  app.put("/simulators/:id", simulatorHandlers.update);
  app.delete("/simulators/batch", simulatorHandlers.removeBatch);
  app.delete("/simulators/:id", simulatorHandlers.remove);

  app.get("/courses", courseHandlers.list);
  app.post("/courses/batch", courseHandlers.createBatch);
  app.put("/courses/:id", courseHandlers.update);
  app.delete("/courses/batch", courseHandlers.removeBatch);
  app.delete("/courses/:id", courseHandlers.remove);

  app.get("/cmas", cmaHandlers.list);
  app.post("/cmas/batch", cmaHandlers.createBatch);
  app.put("/cmas/:id", cmaHandlers.update);
  app.delete("/cmas/batch", cmaHandlers.removeBatch);
  app.delete("/cmas/:id", cmaHandlers.remove);

  app.get("/other-operational-allocations", otherOperationalHandlers.list);
  app.post("/other-operational-allocations/batch", otherOperationalHandlers.createBatch);
  app.put("/other-operational-allocations/:id", otherOperationalHandlers.update);
  app.delete("/other-operational-allocations/batch", otherOperationalHandlers.removeBatch);
  app.delete("/other-operational-allocations/:id", otherOperationalHandlers.remove);

  app.get("/config/next-motor", getNextMotorConfigController);
  app.put("/config/next-motor", updateNextMotorConfigController);

  app.patch("/schedules/:id/manual-cell", manualEditCellController);
  app.patch("/schedules/:id/manual-range", manualEditRangeController);
  app.patch("/schedules/:id/manual-move", manualEditMoveController);

  app.post("/schedules/validate", validateScheduleController);
  app.post("/schedules/generate", generateScheduleController);
  app.post("/schedules/generate-by-steps", generateScheduleByStepsController);
  app.post("/schedules/:id/generate-flights", generateFlightsController);
  app.post("/schedules/:id/generate-apao", generateApaoScheduleController);
  app.get("/schedules/published/:year/:month", getPublishedScheduleController);
  app.post("/schedules/:id/publish", publishScheduleController);
  app.delete("/schedules/:id/generated-data", clearGeneratedScheduleController);
  app.get("/schedules/:year/:month", getScheduleMonthController);
  app.get("/operational-cadastros", listOperationalCadastrosController);
  app.get("/operational-cadastros/debug", debugOperationalCadastrosController);
}
