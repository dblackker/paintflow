import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { apiJson, labelize } from '@/lib/api';

interface Role {
  id: string;
  name?: string | null;
  permissions?: string[] | null;
  isSystem?: boolean | null;
}

interface RoleUser {
  userId: string;
  email?: string | null;
  name?: string | null;
  roleId?: string | null;
  roleName?: string | null;
}

function permissionLabel(permission: string) {
  if (permission === 'all') return 'Full access';
  return labelize(permission);
}

function RolesSkeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {[0, 1, 2].map((item) => (
        <div key={item} className="p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
            <div className="space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-10 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [error, setError] = useState('');

  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError('');
    try {
      const [rolesPayload, usersPayload] = await Promise.all([
        apiJson<{ data?: Role[] }>('/v1/roles'),
        apiJson<{ data?: RoleUser[] }>('/v1/roles/users'),
      ]);
      setRoles(rolesPayload.data || []);
      setUsers(usersPayload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  }

  async function seedDefaults() {
    setIsSeeding(true);
    try {
      await apiJson('/v1/roles/seed', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Default roles created', 'success');
      await loadData();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not seed roles', 'error');
    } finally {
      setIsSeeding(false);
    }
  }

  async function assignRole(userId: string, roleId: string) {
    if (!roleId) return;
    setAssigningUserId(userId);
    try {
      await apiJson('/v1/roles/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ userId, roleId }),
      });
      const role = roleById.get(roleId);
      setUsers((current) => current.map((user) => user.userId === userId ? { ...user, roleId, roleName: role?.name } : user));
      window.showToast?.('Role updated', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not assign role', 'error');
      await loadData();
    } finally {
      setAssigningUserId('');
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">Assign user permissions for the organization.</p>
        <Button type="button" size="sm" isLoading={isSeeding} onClick={seedDefaults}>
          Seed defaults
        </Button>
      </div>

      {error && (
        <Card className="border-red-100 bg-red-50" padding="sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="pf-copy text-red-700">{error}</p>
            <Button type="button" variant="secondary" size="sm" onClick={loadData}>Retry</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card padding="none" className="overflow-hidden">
          <CardHeader
            className="mb-0 border-b border-gray-200 px-4 py-3"
            title="User Roles"
            description="Assign office and field users to roles that match how they work in Crewmodo."
          />
          <CardContent className="divide-y divide-gray-200">
            {isLoading && <RolesSkeleton />}

            {!isLoading && !users.length && (
              <EmptyState
                icon={<Icon name="users" className="h-5 w-5" />}
                title="No users found."
                description="Invite users or create demo crew members before assigning permissions."
              />
            )}

            {!isLoading && users.map((user) => (
              <div key={user.userId} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="pf-row-title truncate">{user.name || user.email || 'User'}</p>
                    {user.roleName && <Badge variant="info" size="sm">{user.roleName}</Badge>}
                  </div>
                  <p className="pf-copy mt-1 truncate">{user.email || 'No email'}</p>
                </div>
                <select
                  className="input"
                  value={user.roleId || ''}
                  disabled={assigningUserId === user.userId}
                  onChange={(event) => assignRole(user.userId, event.target.value)}
                  aria-label={`Role for ${user.name || user.email || 'user'}`}
                >
                  <option value="">No role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Available Roles" description="Defaults are intentionally simple until custom permissions are fully configurable." />
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          ) : roles.length ? (
            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="pf-row-title">{role.name || 'Role'}</p>
                    {role.isSystem && <Badge size="sm">System</Badge>}
                  </div>
                  <p className="pf-helper mt-1">
                    {(role.permissions || []).map(permissionLabel).join(', ') || 'No permissions set'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="pf-copy">No roles yet.</p>
              <Button type="button" size="sm" className="mt-3" isLoading={isSeeding} onClick={seedDefaults}>
                Seed defaults
              </Button>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
