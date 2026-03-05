import { ref } from 'vue'

export type DialogTone = 'default' | 'success' | 'danger'

export interface DialogState {
  visible: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  showCancel: boolean
  tone: DialogTone
}

export interface DialogOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  showCancel?: boolean
  tone?: DialogTone
}

const initialDialogState: DialogState = {
  visible: false,
  title: '提示',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  showCancel: false,
  tone: 'default'
}

export function useDialog() {
  const dialogState = ref<DialogState>({ ...initialDialogState })

  let resolver: ((value: boolean) => void) | null = null

  const showDialog = (options: DialogOptions) => {
    if (resolver) {
      resolver(false)
      resolver = null
    }

    dialogState.value = {
      visible: true,
      title: options.title || '提示',
      message: options.message,
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      showCancel: Boolean(options.showCancel),
      tone: options.tone || 'default'
    }

    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  const closeDialog = (confirmed: boolean) => {
    dialogState.value = {
      ...dialogState.value,
      visible: false
    }

    if (resolver) {
      resolver(confirmed)
      resolver = null
    }
  }

  const showInfoDialog = (message: string, title = '提示') => {
    return showDialog({
      title,
      message,
      showCancel: false,
      confirmText: '我知道了'
    })
  }

  const showConfirmDialog = (
    message: string,
    options?: { title?: string; confirmText?: string; cancelText?: string; tone?: DialogTone }
  ) => {
    return showDialog({
      title: options?.title || '请确认',
      message,
      showCancel: true,
      confirmText: options?.confirmText || '确认',
      cancelText: options?.cancelText || '取消',
      tone: options?.tone || 'default'
    })
  }

  return {
    dialogState,
    showDialog,
    closeDialog,
    showInfoDialog,
    showConfirmDialog
  }
}
