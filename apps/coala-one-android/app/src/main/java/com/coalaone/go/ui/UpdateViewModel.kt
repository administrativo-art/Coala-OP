package com.coalaone.go.ui

import com.coalaone.go.BuildConfig
import com.coalaone.go.data.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import javax.inject.Inject

@HiltViewModel class UpdateViewModel @Inject constructor(private val api: ApiService, private val updater: InstallerDownloader) : FeedbackViewModel() {
    private val mutable = MutableStateFlow<Release?>(null)
    val release = mutable.asStateFlow()
    private val progressMutable = MutableStateFlow(0f)
    val progress = progressMutable.asStateFlow()
    init { if (!BuildConfig.DEBUG || BuildConfig.LOCAL_TEST) check() }
    fun check() = run { mutable.value = api.release() }
    fun download(open: (File) -> Unit) = run {
        val release = mutable.value ?: return@run
        require(release.packagePath != null && release.versionCode > BuildConfig.VERSION_CODE) { "Não há atualização publicada para este aplicativo." }
        open(updater.download(release) { progressMutable.value = it })
    }
}
