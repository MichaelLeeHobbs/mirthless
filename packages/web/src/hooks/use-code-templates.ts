// ===========================================
// Code Template API Hooks
// ===========================================
// TanStack Query hooks for code template library + template CRUD.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCodeTemplateLibraryInput,
  UpdateCodeTemplateLibraryInput,
  CreateCodeTemplateInput,
  UpdateCodeTemplateInput,
} from '@mirthless/core-models';
import { api, type CodeTemplateLibrary, type CodeTemplateDetail } from '../api/client.js';

// ----- Query Keys -----

const CT_KEYS = {
  all: ['code-templates'] as const,
  libraries: () => [...CT_KEYS.all, 'libraries'] as const,
  templates: () => [...CT_KEYS.all, 'templates'] as const,
  templatesByLibrary: (libraryId: string) => [...CT_KEYS.templates(), { libraryId }] as const,
} as const;

// ----- Library Hooks -----

export function useCodeTemplateLibraries(): ReturnType<typeof useQuery<readonly CodeTemplateLibrary[]>> {
  return useQuery({
    queryKey: CT_KEYS.libraries(),
    queryFn: async () => {
      const result = await api.get<readonly CodeTemplateLibrary[]>('/code-templates/libraries');
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCreateLibrary(): ReturnType<typeof useMutation<CodeTemplateLibrary, Error, CreateCodeTemplateLibraryInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCodeTemplateLibraryInput) => {
      const result = await api.post<CodeTemplateLibrary>('/code-templates/libraries', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CT_KEYS.libraries() });
    },
  });
}

export function useUpdateLibrary(): ReturnType<typeof useMutation<CodeTemplateLibrary, Error, { id: string; input: UpdateCodeTemplateLibraryInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCodeTemplateLibraryInput }) => {
      const result = await api.put<CodeTemplateLibrary>(`/code-templates/libraries/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CT_KEYS.libraries() });
    },
  });
}

export function useDeleteLibrary(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/code-templates/libraries/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CT_KEYS.libraries() }),
        queryClient.invalidateQueries({ queryKey: CT_KEYS.templates() }),
      ]);
    },
  });
}

// ----- Template Hooks -----

export function useCodeTemplates(libraryId?: string): ReturnType<typeof useQuery<readonly CodeTemplateDetail[]>> {
  const queryKey = libraryId ? CT_KEYS.templatesByLibrary(libraryId) : CT_KEYS.templates();
  const path = libraryId ? `/code-templates?libraryId=${libraryId}` : '/code-templates';

  return useQuery({
    queryKey,
    queryFn: async () => {
      const result = await api.get<readonly CodeTemplateDetail[]>(path);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useCreateTemplate(): ReturnType<typeof useMutation<CodeTemplateDetail, Error, CreateCodeTemplateInput>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCodeTemplateInput) => {
      const result = await api.post<CodeTemplateDetail>('/code-templates', input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CT_KEYS.templates() }),
        queryClient.invalidateQueries({ queryKey: CT_KEYS.libraries() }),
      ]);
    },
  });
}

export function useUpdateTemplate(): ReturnType<typeof useMutation<CodeTemplateDetail, Error, { id: string; input: UpdateCodeTemplateInput }>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCodeTemplateInput }) => {
      const result = await api.put<CodeTemplateDetail>(`/code-templates/${id}`, input);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CT_KEYS.templates() });
    },
  });
}

export function useDeleteTemplate(): ReturnType<typeof useMutation<void, Error, string>> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.delete<void>(`/code-templates/${id}`);
      if (!result.success) throw new Error(result.error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CT_KEYS.templates() }),
        queryClient.invalidateQueries({ queryKey: CT_KEYS.libraries() }),
      ]);
    },
  });
}
