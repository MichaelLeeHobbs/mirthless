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
import CircularProgress from '@mui/material/CircularProgress';
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
import { CERTIFICATE_TYPE } from '@mirthless/core-models';
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

// ----- Delete Confirmation Dialog -----

function DeleteConfirmDialog(props: {
  readonly open: boolean;
  readonly certName: string;
  readonly isPending: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <Dialog open={props.open} onClose={props.onCancel}>
      <DialogTitle>Delete Certificate</DialogTitle>
      <DialogContent>
        <Typography>
          Are you sure you want to delete &quot;{props.certName}&quot;? This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button onClick={props.onConfirm} color="error" variant="contained" disabled={props.isPending}>
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ----- Page Component -----

export function CertificatesPage(): ReactNode {
  const { data: certificates, isLoading, error, isFetching } = useCertificates();
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Certificates</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Add Certificate
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load certificates: {error.message}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
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
              {certificates && certificates.length > 0 ? (
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
                          <IconButton size="small" onClick={() => { handleOpenEdit(cert); }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => { handleDeleteClick(cert); }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                      No certificates found
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

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
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        certName={deleteTarget?.name ?? ''}
        isPending={deleteCertificate.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </Box>
  );
}
