// ===========================================
// Certificates Page
// ===========================================
// SSL/TLS certificate management: list, create/edit with PEM text area, expiry indicators.

import { useState, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SecurityIcon from '@mui/icons-material/Security';
import { CERTIFICATE_TYPE } from '@mirthless/core-models';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import {
  useCertificates,
  useCertificate,
  useCreateCertificate,
  useUpdateCertificate,
  useDeleteCertificate,
  type CertificateSummary,
} from '../hooks/use-certificates.js';

// ----- Helpers -----

function getExpiryDays(notAfter: string): number {
  const expiry = new Date(notAfter).getTime();
  const now = Date.now();
  return Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
}

function getExpiryColor(days: number): 'error' | 'warning' | 'success' {
  if (days < 30) return 'error';
  if (days < 90) return 'warning';
  return 'success';
}

function getExpiryLabel(days: number): string {
  if (days < 0) return `Expired ${String(-days)}d ago`;
  return `${String(days)}d remaining`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

const CERT_TYPES = [
  CERTIFICATE_TYPE.CA,
  CERTIFICATE_TYPE.CLIENT,
  CERTIFICATE_TYPE.SERVER,
  CERTIFICATE_TYPE.KEYPAIR,
] as const;

// ----- Page Component -----

export function CertificatesPage(): ReactNode {
  const { data: certificates, isLoading, error, isFetching, refetch } = useCertificates();
  const createCertificate = useCreateCertificate();
  const updateCertificate = useUpdateCertificate();
  const deleteCertificate = useDeleteCertificate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [certType, setCertType] = useState<string>(CERTIFICATE_TYPE.CA);
  const [certificatePem, setCertificatePem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CertificateSummary | null>(null);

  const { data: editingDetail, isLoading: isDetailLoading } = useCertificate(editingId ?? '');

  // Sync PEM content when editing detail loads
  useEffect(() => {
    if (editingDetail) {
      setCertificatePem(editingDetail.certificatePem);
      setPrivateKeyPem(editingDetail.privateKeyPem ?? '');
    }
  }, [editingDetail]);

  const handleOpenCreate = (): void => {
    setEditingId(null);
    setName('');
    setDescription('');
    setCertType(CERTIFICATE_TYPE.CA);
    setCertificatePem('');
    setPrivateKeyPem('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (cert: CertificateSummary): void => {
    setEditingId(cert.id);
    setName(cert.name);
    setDescription(cert.description ?? '');
    setCertType(cert.type);
    setCertificatePem('');
    setPrivateKeyPem('');
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleClose = (): void => {
    setDialogOpen(false);
    setEditingId(null);
    setDialogError(null);
  };

  const handleSave = (): void => {
    if (editingId) {
      updateCertificate.mutate(
        {
          id: editingId,
          input: {
            name,
            description,
            type: certType as typeof CERTIFICATE_TYPE[keyof typeof CERTIFICATE_TYPE],
            certificatePem,
            privateKeyPem: privateKeyPem.length > 0 ? privateKeyPem : null,
          },
        },
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    } else {
      const input: Record<string, unknown> = {
        name,
        type: certType,
        certificatePem,
      };
      if (description.length > 0) input['description'] = description;
      if (privateKeyPem.length > 0) input['privateKeyPem'] = privateKeyPem;

      createCertificate.mutate(
        input as Parameters<typeof createCertificate.mutate>[0],
        {
          onSuccess: () => { handleClose(); },
          onError: (err) => { setDialogError(err.message); },
        },
      );
    }
  };

  const handleDeleteClick = (cert: CertificateSummary): void => {
    setDeleteTarget(cert);
  };

  const handleDeleteConfirm = (): void => {
    if (deleteTarget) {
      deleteCertificate.mutate(deleteTarget.id, {
        onSuccess: () => { setDeleteTarget(null); },
      });
    }
  };

  const handleDeleteCancel = (): void => {
    setDeleteTarget(null);
  };

  return (
    <Box>
      <PageHeader
        title="Certificates"
        description="Manage SSL/TLS certificates and key pairs for secure connectors."
        isFetching={isFetching && !isLoading}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add Certificate
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        Certificates stored here are referenced by ID from HTTPS connectors (HTTP
        source/destination). The server resolves the referenced material to PEM at
        deploy time — no key material leaves this store through the API.
      </Alert>

      {error && (
        <ErrorState title="Couldn't load certificates" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell>Issuer</TableCell>
              <TableCell>Expiry</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={6} />
            ) : certificates && certificates.length > 0 ? (
              certificates.map((cert) => {
                  const days = getExpiryDays(cert.notAfter);
                  const color = getExpiryColor(days);
                  return (
                    <TableRow key={cert.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{cert.name}</Typography>
                        {cert.description ? (
                          <Typography variant="caption" color="text.secondary">{cert.description}</Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Chip label={cert.type} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{cert.subject}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{cert.issuer}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={getExpiryLabel(days)} size="small" color={color} />
                        <Typography variant="caption" display="block" color="text.secondary">
                          {formatDate(cert.notBefore)} - {formatDate(cert.notAfter)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton aria-label="Edit certificate" size="small" onClick={() => { handleOpenEdit(cert); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton aria-label="Delete certificate" size="small" onClick={() => { handleDeleteClick(cert); }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })
            ) : (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    dense
                    icon={<SecurityIcon />}
                    title="No certificates yet"
                    description="Add an SSL/TLS certificate to secure your connectors."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editingId ? 'Edit Certificate' : 'Add Certificate'}</DialogTitle>
        <DialogContent>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
          />
          <TextField
            margin="dense"
            label="Type"
            fullWidth
            select
            value={certType}
            onChange={(e) => { setCertType(e.target.value); }}
          >
            {CERT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </TextField>
          <TextField
            margin="dense"
            label="Certificate PEM"
            fullWidth
            multiline
            rows={8}
            value={certificatePem}
            onChange={(e) => { setCertificatePem(e.target.value); }}
            disabled={editingId != null && isDetailLoading}
            placeholder={editingId != null && isDetailLoading ? 'Loading...' : '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            sx={{ fontFamily: 'monospace' }}
          />
          <TextField
            margin="dense"
            label="Private Key PEM (optional)"
            fullWidth
            multiline
            rows={6}
            value={privateKeyPem}
            onChange={(e) => { setPrivateKeyPem(e.target.value); }}
            disabled={editingId != null && isDetailLoading}
            placeholder="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
            sx={{ fontFamily: 'monospace' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!name.trim() || !certificatePem.trim() || createCertificate.isPending || updateCertificate.isPending}
          >
            {editingId ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Certificate"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteCertificate.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </Box>
  );
}
