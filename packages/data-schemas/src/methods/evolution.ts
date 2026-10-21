import { Schema } from 'mongoose';
import { emptyEvolutionState } from 'librechat-data-provider';
import type { EvolutionScope, EvolutionState, EvolutionArtifact } from 'librechat-data-provider';

export type EvolutionStore = {
  read: (scope: EvolutionScope) => Promise<EvolutionState>;
  claim: (scope: EvolutionScope, runId: string, until: Date, now: Date) => Promise<boolean>;
  save: (
    scope: EvolutionScope,
    state: EvolutionState,
    runId: string | null,
    now: Date,
  ) => Promise<boolean>;
  release: (scope: EvolutionScope, runId: string) => Promise<void>;
  busy: (scope: EvolutionScope, now: Date) => Promise<boolean>;
  saveArtifact: (
    scope: EvolutionScope,
    artifact: EvolutionArtifact,
    expiresAt: Date,
  ) => Promise<void>;
  getArtifact: (scope: EvolutionScope, id: string) => Promise<EvolutionArtifact | null>;
  owner: (scope: EvolutionScope) => Promise<{ id: string; role: string; tenantId?: string } | null>;
};
type Stored = {
  _id: string;
  state: EvolutionState;
  revision: number;
  leaseId: string | null;
  leaseUntil: Date;
};
type ArtifactRecord = EvolutionArtifact & { _id: string; scope: string; expiresAt: Date };
const key = (scope: EvolutionScope) => JSON.stringify([scope.tenantId, scope.ownerUserId]);

/** Separate models keep the registry independent of package/skill deletion. */
export function createEvolutionStore(mongoose: typeof import('mongoose')): EvolutionStore {
  const registrySchema = new Schema<Stored>(
    {
      _id: String,
      state: Schema.Types.Mixed,
      revision: { type: Number, default: 0 },
      leaseId: { type: String, default: null },
      leaseUntil: { type: Date, default: () => new Date(0) },
    },
    { minimize: false, versionKey: false },
  );
  const artifactSchema = new Schema<ArtifactRecord>(
    {
      _id: String,
      scope: { type: String, required: true },
      id: String,
      name: String,
      mime: String,
      data: String,
      createdAt: String,
      expiresAt: { type: Date, expires: 0 },
    },
    { versionKey: false },
  );
  const Registry =
    mongoose.models.EvolutionRegistry ??
    mongoose.model<Stored>('EvolutionRegistry', registrySchema);
  const Artifacts =
    mongoose.models.EvolutionArtifact ??
    mongoose.model<ArtifactRecord>('EvolutionArtifact', artifactSchema);
  const ensure = async (scope: EvolutionScope) => {
    try {
      await Registry.updateOne(
        { _id: key(scope) },
        {
          $setOnInsert: {
            state: emptyEvolutionState(),
            revision: 0,
            leaseId: null,
            leaseUntil: new Date(0),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
    }
  };
  return {
    async read(scope) {
      const record = await Registry.findById(key(scope)).lean<Stored>();
      return record ? { ...record.state, revision: record.revision } : emptyEvolutionState();
    },
    async claim(scope, runId, until, now) {
      await ensure(scope);
      const result = await Registry.updateOne(
        { _id: key(scope), leaseUntil: { $lte: now } },
        { $set: { leaseId: runId, leaseUntil: until } },
      );
      return result.modifiedCount === 1;
    },
    async save(scope, state, runId, now) {
      await ensure(scope);
      const lease = runId
        ? { leaseId: runId, leaseUntil: { $gt: now } }
        : { leaseUntil: { $lte: now } };
      const result = await Registry.updateOne(
        { _id: key(scope), revision: state.revision, ...lease },
        { $set: { state: { ...state, revision: state.revision + 1 } }, $inc: { revision: 1 } },
      );
      if (result.modifiedCount === 1) {
        state.revision++;
        return true;
      }
      return false;
    },
    async release(scope, runId) {
      await Registry.updateOne(
        { _id: key(scope), leaseId: runId },
        { $set: { leaseId: null, leaseUntil: new Date(0) } },
      );
    },
    async busy(scope, now) {
      return !!(await Registry.exists({ _id: key(scope), leaseUntil: { $gt: now } }));
    },
    async saveArtifact(scope, artifact, expiresAt) {
      await Artifacts.updateOne(
        { _id: `${key(scope)}:${artifact.id}` },
        { $setOnInsert: { ...artifact, scope: key(scope), expiresAt } },
        { upsert: true },
      );
    },
    async getArtifact(scope, id) {
      const record = await Artifacts.findOne({
        _id: `${key(scope)}:${id}`,
        scope: key(scope),
        expiresAt: { $gt: new Date() },
      }).lean<ArtifactRecord>();
      return record
        ? {
            id: record.id,
            name: record.name,
            mime: record.mime,
            data: record.data,
            createdAt: record.createdAt,
          }
        : null;
    },
    async owner(scope) {
      const user = await mongoose.models.User.findOne({
        _id: scope.ownerUserId,
        ...(scope.tenantId
          ? { tenantId: scope.tenantId }
          : { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: '' }] }),
      })
        .select('_id role tenantId')
        .lean<{ _id: { toString: () => string }; role: string; tenantId?: string }>();
      return user ? { id: user._id.toString(), role: user.role, tenantId: user.tenantId } : null;
    },
  };
}
